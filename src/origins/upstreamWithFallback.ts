import { ErrorResponse } from "../helpers/response";
import { emitGatewayLog, toErrorMessage } from "../gateway/logging";
import { IRequest, TOriginHandler } from "../types";

type HealthCheckResult = {
    healthy: boolean;
    timestamp: number;
};

type UpstreamWithFallbackOptions = {
    primaryUrl: string;
    fallbackUrl: string;
    healthCheckPath?: string;
    healthCheckTimeout?: number;
    healthCheckCacheTtl?: number;
};

// In-memory cache for health status
const healthCache = new Map<string, HealthCheckResult>();

/**
 * Rewrites the Location header to point back to the gateway
 */
function rewriteLocation(
    location: string | null,
    gatewayUrl: URL,
    primaryUrl: string,
    fallbackUrl: string
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
            // Relative URLs are fine as they resolve correctly to the gateway origin
            return location;
        }

        // Check if location points to one of our upstreams
        const isPrimary = (locUrl.hostname === primary.hostname);
        const isFallback = (locUrl.hostname === fallback.hostname);

        if (isPrimary || isFallback) {
            // Reconstruct the URL using the gateway's origin
            // For upstreamWithFallback, we don't have a stripPrefix option in its type yet,
            // but we can assume it's root or handled by the caller.
            const newPath = locUrl.pathname + locUrl.search + locUrl.hash;
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
            originType: "upstreamWithFallback",
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
            originType: "upstreamWithFallback",
            targetUrl: `${baseUrl.replace(/\/$/, '')}${healthPath}`,
            errorMessage: toErrorMessage(error),
        });
        return false;
    }
}

/**
 * Get cached health status or perform health check
 */
async function getHealthStatus(
    url: string,
    healthPath: string,
    timeout: number,
    cacheTtl: number
): Promise<boolean> {
    const now = Date.now();
    const cached = healthCache.get(url);

    // Return cached result if available and not expired
    if (cached && (now - cached.timestamp) < cacheTtl) {
        return cached.healthy;
    }

    // Perform health check
    const healthy = await checkUpstreamHealth(url, healthPath, timeout);

    // Cache the result
    healthCache.set(url, {
        healthy,
        timestamp: now,
    });

    return healthy;
}

/**
 * Upstream origin handler with automatic failover
 * 
 * Routes requests to primary upstream with automatic failover to fallback
 * if primary is unhealthy or fails to respond.
 */
export const upstreamWithFallback: TOriginHandler = async (
    request: IRequest,
    options: UpstreamWithFallbackOptions
) => {
    const {
        primaryUrl,
        fallbackUrl,
        healthCheckPath = '/api/health',
        healthCheckTimeout = 5000,
        healthCheckCacheTtl = 60000, // 60 seconds
    } = options;

    // Parse the request URL to get path and query
    const url = new URL(request.url);
    const pathAndQuery = url.pathname + url.search;

    // Check primary upstream health
    const isPrimaryHealthy = await getHealthStatus(
        primaryUrl,
        healthCheckPath,
        healthCheckTimeout,
        healthCheckCacheTtl
    );

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
            originType: "upstreamWithFallback",
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
            originType: "upstreamWithFallback",
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
    headers.delete('host');

    const upstreamRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: bodyBuffer,
    });

    try {
        const upstreamResponse = await fetch(upstreamRequest, {
            redirect: 'manual'
        });

        // If primary failed and we haven't tried fallback yet, try fallback
        // We only fallback on server errors (5xx) or if the primary is down.
        if (upstreamResponse.status >= 500 && !isUsingFallback) {
            const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, '')}${pathAndQuery}`;
            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "primary_failed",
                method: request.method,
                path: url.pathname,
                originType: "upstreamWithFallback",
                status: upstreamResponse.status,
                targetUrl,
            });
            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "fallback_started",
                method: request.method,
                path: url.pathname,
                originType: "upstreamWithFallback",
                targetUrl: fallbackTargetUrl,
            });
            const fallbackHeaders = new Headers(request.headers);
            fallbackHeaders.delete('host');

            const fallbackRequest = new Request(fallbackTargetUrl, {
                method: request.method,
                headers: fallbackHeaders,
                body: bodyBuffer,
                redirect: 'manual'
            });

            const fallbackResponse = await fetch(fallbackRequest);

            // Rewrite Location header for fallback response
            const responseHeaders = new Headers(fallbackResponse.headers);
            const location = responseHeaders.get('Location');
            if (location) {
                const newLocation = rewriteLocation(location, url, primaryUrl, fallbackUrl);
                if (newLocation) responseHeaders.set('Location', newLocation);
            }

            emitGatewayLog(undefined, {
                level: "info",
                stage: "origin",
                outcome: "fallback_completed",
                method: request.method,
                path: url.pathname,
                originType: "upstreamWithFallback",
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
            const newLocation = rewriteLocation(location, url, primaryUrl, fallbackUrl);
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
            originType: "upstreamWithFallback",
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
                    originType: "upstreamWithFallback",
                    targetUrl: fallbackTargetUrl,
                });
                const fallbackHeaders = new Headers(request.headers);
                fallbackHeaders.delete('host');

                const fallbackRequest = new Request(fallbackTargetUrl, {
                    method: request.method,
                    headers: fallbackHeaders,
                    body: bodyBuffer,
                });

                const fallbackResponse = await fetch(fallbackRequest);
                emitGatewayLog(undefined, {
                    level: "info",
                    stage: "origin",
                    outcome: "fallback_completed",
                    method: request.method,
                    path: url.pathname,
                    originType: "upstreamWithFallback",
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
                    originType: "upstreamWithFallback",
                    errorMessage: toErrorMessage(fallbackError),
                });
            }
        }

        return new ErrorResponse("All upstreams failed", 503);
    }
};
