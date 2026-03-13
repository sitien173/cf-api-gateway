import { ErrorResponse } from "../helpers/response";
import { emitGatewayLog, toErrorMessage } from "../gateway/logging";
import { IRequest, TOriginHandler } from "../types";

type ProxyAllOptions = {
    primaryUrl: string;
    fallbackUrl: string;
    stripPrefix?: string;  // Optional prefix to strip from request path
    healthCheckPath?: string;
    healthCheckTimeout?: number;
    healthCheckCacheTtl?: number;
};

// In-memory cache for health status
const healthCache = new Map<string, { healthy: boolean; timestamp: number }>();

/**
 * Rewrites the Location header to point back to the gateway
 */
function rewriteLocation(
    location: string | null,
    gatewayUrl: URL,
    primaryUrl: string,
    fallbackUrl: string,
    stripPrefix?: string
): string | null {
    if (!location) return null;

    try {
        const primary = new URL(primaryUrl);
        const fallback = new URL(fallbackUrl);

        // Try parsing the location as a full URL
        let locUrl: URL;
        try {
            locUrl = new URL(location);
        } catch {
            // If it's a relative URL, it might be something like "/api/sync"
            // We need to re-add the prefix if it's missing
            if (location.startsWith('/') && stripPrefix && !location.startsWith(stripPrefix)) {
                return stripPrefix.replace(/\/$/, '') + location;
            }
            return location;
        }

        // Check if location points to one of our upstreams
        const isPrimary = (locUrl.hostname === primary.hostname);
        const isFallback = (locUrl.hostname === fallback.hostname);

        if (isPrimary || isFallback) {
            // Reconstruct the URL using the gateway's origin and prefix
            const prefix = stripPrefix || "";
            const newPath = prefix.replace(/\/$/, '') + locUrl.pathname + locUrl.search + locUrl.hash;
            return `${gatewayUrl.origin}${newPath}`;
        }

        return location;
    } catch (e) {
        emitGatewayLog(undefined, {
            level: "error",
            stage: "origin_rewrite",
            outcome: "failed",
            method: "GET",
            path: gatewayUrl.pathname,
            originType: "proxyAll",
            errorMessage: toErrorMessage(e),
        });
        return location;
    }
}

/**
 * Check if an upstream is healthy
 */
async function checkUpstreamHealth(
    baseUrl: string,
    healthPath: string = "/api/health",
    timeout: number = 5000
): Promise<boolean> {
    try {
        const healthUrl = `${baseUrl.replace(/\/$/, '')}${healthPath}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        emitGatewayLog(undefined, {
            level: "error",
            stage: "origin_health",
            outcome: "check_failed",
            method: "GET",
            path: healthPath,
            originType: "proxyAll",
            targetUrl: `${baseUrl.replace(/\/$/, '')}${healthPath}`,
            errorMessage: toErrorMessage(error),
        });
        return false;
    }
}

/**
 * Proxy all requests with automatic failover
 * 
 * This origin handler proxies ALL requests to the configured upstreams
 * regardless of the route path. Use this for a simple catch-all gateway.
 */
export const proxyAll: TOriginHandler = async (
    request: IRequest,
    options: ProxyAllOptions
) => {
    const {
        primaryUrl,
        fallbackUrl,
        stripPrefix,
        healthCheckPath = '/api/health',
        healthCheckTimeout = 5000,
        healthCheckCacheTtl = 60000,
    } = options;

    // Parse the request URL to get path and query
    const url = new URL(request.url);
    let pathAndQuery = url.pathname + url.search;

    // Strip prefix if specified (e.g., /udemy/api/health → /api/health)
    if (stripPrefix && pathAndQuery.startsWith(stripPrefix)) {
        pathAndQuery = pathAndQuery.substring(stripPrefix.length);
        // Ensure path starts with /
        if (!pathAndQuery.startsWith('/')) {
            pathAndQuery = '/' + pathAndQuery;
        }
    }

    // Check primary upstream health (with caching)
    const now = Date.now();
    const cached = healthCache.get(primaryUrl);
    let isPrimaryHealthy: boolean;

    if (cached && (now - cached.timestamp) < healthCheckCacheTtl) {
        isPrimaryHealthy = cached.healthy;
    } else {
        isPrimaryHealthy = await checkUpstreamHealth(primaryUrl, healthCheckPath, healthCheckTimeout);
        healthCache.set(primaryUrl, { healthy: isPrimaryHealthy, timestamp: now });
    }

    // Determine target URL
    let targetUrl: string;
    let isUsingFallback = false;

    if (isPrimaryHealthy) {
        targetUrl = `${primaryUrl.replace(/\/$/, '')}${pathAndQuery}`;
        emitGatewayLog(undefined, {
            level: "info",
            stage: "origin",
            outcome: "routed_primary",
            method: request.method,
            path: url.pathname,
            originType: "proxyAll",
            targetUrl,
        });
    } else {
        targetUrl = `${fallbackUrl.replace(/\/$/, '')}${pathAndQuery}`;
        isUsingFallback = true;
        emitGatewayLog(undefined, {
            level: "info",
            stage: "origin",
            outcome: "routed_fallback",
            method: request.method,
            path: url.pathname,
            originType: "proxyAll",
            targetUrl,
        });
    }

    // Read the body once if it exists (to avoid ReadableStream locked errors)
    let bodyBuffer: ArrayBuffer | undefined = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        bodyBuffer = await request.arrayBuffer();
    }

    // Create the upstream request
    const headers = new Headers(request.headers);
    // Remove the host header to let the fetch call set it correctly for the target
    headers.delete('host');

    const upstreamRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: bodyBuffer,
    });

    try {
        const upstreamResponse = await fetch(upstreamRequest, {
            redirect: 'manual' // Handle redirects manually to rewrite Location headers
        });

        // If primary failed and we haven't tried fallback yet, try fallback
        // We only fallback on server errors (5xx) or if the primary is down.
        // We should NOT fallback on 401 (Unauthorized) or 403 (Forbidden) as these are legitimate responses.
        if (upstreamResponse.status >= 500 && !isUsingFallback) {
            const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, '')}${pathAndQuery}`;
            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "primary_failed",
                method: request.method,
                path: url.pathname,
                originType: "proxyAll",
                status: upstreamResponse.status,
                targetUrl,
            });
            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "fallback_started",
                method: request.method,
                path: url.pathname,
                originType: "proxyAll",
                targetUrl: fallbackTargetUrl,
            });
            const fallbackHeaders = new Headers(request.headers);
            fallbackHeaders.delete('host');

            const fallbackRequest = new Request(fallbackTargetUrl, {
                method: request.method,
                headers: fallbackHeaders,
                body: bodyBuffer,  // Reuse the already-read body buffer
                redirect: 'manual'
            });

            const fallbackResponse = await fetch(fallbackRequest);

            // Rewrite Location header for fallback response
            const responseHeaders = new Headers(fallbackResponse.headers);
            const location = responseHeaders.get('Location');
            if (location) {
                const newLocation = rewriteLocation(location, url, primaryUrl, fallbackUrl, stripPrefix);
                if (newLocation) responseHeaders.set('Location', newLocation);
            }

            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "fallback_completed",
                method: request.method,
                path: url.pathname,
                originType: "proxyAll",
                status: fallbackResponse.status,
                targetUrl: fallbackTargetUrl,
            });

            return new Response(fallbackResponse.body, {
                status: fallbackResponse.status,
                headers: responseHeaders
            });
        }

        // Rewrite Location header for primary response
        const responseHeaders = new Headers(upstreamResponse.headers);
        const location = responseHeaders.get('Location');
        if (location) {
            const newLocation = rewriteLocation(location, url, primaryUrl, fallbackUrl, stripPrefix);
            if (newLocation) responseHeaders.set('Location', newLocation);
        }

        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: responseHeaders
        });
    } catch (error) {
        emitGatewayLog(undefined, {
            level: "error",
            stage: "origin",
            outcome: "request_failed",
            method: request.method,
            path: url.pathname,
            originType: "proxyAll",
            targetUrl,
            errorMessage: toErrorMessage(error),
        });

        // If we were trying primary and it failed, try fallback
        if (!isUsingFallback) {
            try {
                const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, '')}${pathAndQuery}`;
                emitGatewayLog(undefined, {
                    level: "info",
                    stage: "origin",
                    outcome: "fallback_started",
                    method: request.method,
                    path: url.pathname,
                    originType: "proxyAll",
                    targetUrl: fallbackTargetUrl,
                });
                const fallbackHeaders = new Headers(request.headers);
                fallbackHeaders.delete('host');

                const fallbackRequest = new Request(fallbackTargetUrl, {
                    method: request.method,
                    headers: fallbackHeaders,
                    body: bodyBuffer,  // Reuse the already-read body buffer
                });

                const fallbackResponse = await fetch(fallbackRequest);
                emitGatewayLog(undefined, {
                    level: "info",
                    stage: "origin",
                    outcome: "fallback_completed",
                    method: request.method,
                    path: url.pathname,
                    originType: "proxyAll",
                    status: fallbackResponse.status,
                    targetUrl: fallbackTargetUrl,
                });
                return new Response(fallbackResponse.body, fallbackResponse);
            } catch (fallbackError) {
                emitGatewayLog(undefined, {
                    level: "error",
                    stage: "origin",
                    outcome: "fallback_failed",
                    method: request.method,
                    path: url.pathname,
                    originType: "proxyAll",
                    errorMessage: toErrorMessage(fallbackError),
                });
            }
        }

        return new ErrorResponse("All upstreams failed", 503);
    }
};
