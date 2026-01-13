# Cloudflare Workers Edge API Gateway

![](./assets/gateway.png)

An API Gateway that deploys to Cloudflare's Edge Network with intelligent routing, health checking, and automatic failover. Perfect for multi-project setups with path-based routing.

## Features

✅ **Edge Deployment**: Runs in 250+ Cloudflare locations worldwide  
✅ **Health-Based Routing**: Automatically routes to healthy upstream servers  
✅ **Automatic Failover**: Falls back to secondary servers if primary fails  
✅ **Path Prefix Support**: Route multiple projects through one gateway  
✅ **Smart Caching**: Health status cached for 60s to reduce overhead  
✅ **Zero Downtime**: Seamless switching between upstreams  
✅ **Analytics Tracking**: Optional Analytics Engine integration  
✅ **Free Tier**: 100,000 requests/day included  

---

## Quick Start (5 Minutes)

### 1. Install and Configure

```bash
cd e:\projects\udemy\cf-workers-api-gateway
npm install

# Copy example configuration
cp src\config.simple.json src\config.json
```

### 2. Update Configuration

Edit `src/config.json` with your URLs:

```json
{
  "routes": [
    {
      "path": "/udemy/",
      "method": "GET",
      "origin": {
        "type": "proxyAll",
        "options": {
          "primaryUrl": "https://api-udemy.hcmc.online",
          "fallbackUrl": "https://udemy-worker.workers.dev",
          "stripPrefix": "/udemy",
          "healthCheckPath": "/api/health"
        }
      }
    }
  ]
}
```

### 3. Deploy

```bash
npx wrangler publish
```

That's it! Your gateway is now live at `https://api-gateway.YOUR-SUBDOMAIN.workers.dev`

---

## Architecture

```
┌──────────┐
│  Clients │
└────┬─────┘
     │
     ▼
┌──────────────────────────────┐
│  API Gateway (Cloudflare Edge) │ ◄── Health Checking (60s cache)
└────┬─────────────┬────────────┘
     │             │
  Primary      Fallback
     │             │
     ▼             ▼
┌─────────┐   ┌─────────────┐
│ ASP.NET │   │ CF Worker   │
│ Backend │   │  (D1 DB)    │
└─────────┘   └─────────────┘
     │             │
     ▼             ▼
┌───────────────────────────┐
│    PostgreSQL / D1 DB     │
└───────────────────────────┘
```

### Request Flow

1. **Client Request** → Gateway at `/udemy/api/health`
2. **Route Matching** → Prefix match on `/udemy/`
3. **Health Check** → Is primary healthy? (cached 60s)
4. **Path Transform** → Strip `/udemy` → `/api/health`
5. **Forward Request** → Send to primary or fallback
6. **Auto Retry** → If primary fails mid-request, retry with fallback

---

## Configuration Guide

### Multi-Project Setup

Support multiple projects with path prefixes:

```json
{
  "routes": [
    {
      "path": "/udemy/",
      "method": "GET",
      "origin": {
        "type": "proxyAll",
        "options": {
          "primaryUrl": "https://api-udemy.hcmc.online",
          "fallback Url": "https://udemy-worker.workers.dev",
          "stripPrefix": "/udemy",
          "healthCheckPath": "/api/health",
          "healthCheckTimeout": 5000,
          "healthCheckCacheTtl": 60000
        }
      },
      "policies": {
        "request": [],
        "response": []
      }
    },
    {
      "path": "/project2/",
      "method": "GET",
      "origin": {
        "type": "proxyAll",
        "options": {
          "primaryUrl": "https://api-project2.example.com",
          "fallbackUrl": "https://project2-worker.workers.dev",
          "stripPrefix": "/project2"
        }
      }
    }
  ]
}
```

**Note**: Add routes for each HTTP method (GET, POST, PUT, DELETE) per project.

### Configuration Options

#### Origin Types

| Type | Description | Use Case |
|------|-------------|----------|
| `url` | Simple URL forwarding | Static endpoints |
| `proxyAll` | Prefix-based proxy with health checking | Multi-project gateway |
| `upstreamWithFallback` | Per-route failover | Specific endpoint control |

#### proxyAll Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `primaryUrl` | string | *required* | Primary upstream server |
| `fallbackUrl` | string | *required* | Fallback server |
| `stripPrefix` | string | `null` | Prefix to remove before forwarding |
| `healthCheckPath` | string | `/api/health` | Health check endpoint |
| `healthCheckTimeout` | number | `5000` | Health check timeout (ms) |
| `healthCheckCacheTtl` | number | `60000` | Health cache duration (ms) |

#### Policies

Add request/response policies for auth, CORS, etc.:

```json
{
  "policies": [
    {
      "name": "cors",
      "type": "cors",
      "options": {
        "allowedOrigins": ["*"]
      }
    }
  ]
}
```

Apply to routes:

```json
{
  "path": "/api/data",
  "policies": {
    "request": ["auth-check"],
    "response": ["cors"]
  }
}
```

---

## Testing & Monitoring

### Local Testing

```bash
# Start local server
npx wrangler dev --local

# Test endpoint
curl http://localhost:8787/udemy/api/health
```

### Production Testing

```bash
# Health check
curl https://api-gateway.YOUR-SUBDOMAIN.workers.dev/udemy/api/health

# With authentication
curl -H "X-License-Key: YOUR_KEY" \
  https://api-gateway.YOUR-SUBDOMAIN.workers.dev/udemy/api/folders
```

### View Logs

```bash
npx wrangler tail --format pretty
```

Expected output:
```
[ProxyAll] Primary: https://api-udemy.hcmc.online/api/health
[ProxyAll] Fallback: https://udemy-worker.workers.dev/api/health
[ProxyAll] Primary failed, trying fallback...
```

### Test Failover

1. Stop primary backend
2. Make request to gateway
3. Should return response from fallback
4. Start primary backend
5. Wait 60s (health cache)
6. Should return response from primary

---

## Analytics Integration

Enable Analytics Engine to track requests, latency, and errors:

### 1. Enable in wrangler.toml

```toml
analytics_engine_datasets = [
  { binding = "ANALYTICS" }
]

[vars]
GATEWAY_NAME = "api-gateway"
ANALYTICS_ENABLED = "true"
```

### 2. Deploy

```bash
npx wrangler publish
```

### 3. View Analytics

- Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- Navigate to Workers & Pages → Your Worker
- Click Analytics Engine tab

**Free Tier**: 10M writes/month, 100K reads/month

---

## Usage Examples

### Update Your Applications

**Before** (direct backend):
```javascript
const API_URL = 'https://api-udemy.hcmc.online';
```

**After** (via gateway):
```javascript
const API_URL = 'https://api-gateway.YOUR-SUBDOMAIN.workers.dev/udemy';
```

### Android/Kotlin

```kotlin
const val BASE_URL = "https://api-gateway.YOUR-SUBDOMAIN.workers.dev/udemy"
```

### iOS/Swift

```swift
let baseURL = "https://api-gateway.YOUR-SUBDOMAIN.workers.dev/udemy"
```

---

## Troubleshooting

### 404 Not Found

**Issue**: Route not found  
**Solution**:
- Check path starts with configured prefix (`/udemy/`)
- Verify HTTP method matches (GET/POST/PUT/DELETE)
- Ensure route exists in `config.json`

### 503 Service Unavailable

**Issue**: All upstreams down  
**Solution**:
- Check primary health endpoint is accessible
- Verify fallback server is running
- Use `wrangler tail` to see health check logs

### Always Routing to Fallback

**Issue**: Primary health check failing  
**Solution**:
- Verify `/api/health` endpoint returns 200 OK
- Check `primaryUrl` is accessible from internet
- Increase `healthCheckTimeout` if network is slow

### TypeScript Errors

**Issue**: Missing type definitions  
**Impact**: None (compile-time only)  
**Fix** (optional):
```bash
npm install -D @cloudflare/workers-types
```

---

## Advanced Configuration

### Custom Health Check

```json
{
  "healthCheckPath": "/custom/health",
  "healthCheckTimeout": 10000,
  "healthCheckCacheTtl": 30000
}
```

### Rate Limiting (Future)

Add rate limiting policy:

```json
{
  "name": "rate-limit",
  "type": "rateLimit",
  "options": {
    "requestsPerMinute": 100
  }
}
```

### Authentication Policies

```json
{
  "name": "jwt-auth",
  "type": "auth0jwt",
  "options": {
    "issuer": "https://your-domain.auth0.com/",
    "audience": "https://your-api"
  }
}
```

---

## Performance

- **Edge Deployment**: 250+ locations worldwide
- **Low Latency**: <50ms response time overhead
- **Health Caching**: Reduces backend health check load
- **Automatic Failover**: <100ms failover time
- **Free Tier**: 100K requests/day
- **Paid Tier**: $0.50 per million requests

---

## Production Checklist

- [ ] Updated `primaryUrl` and `fallbackUrl` in config
- [ ] Added `stripPrefix` for path-based routing
- [ ] Configured CORS policy if needed
- [ ] Tested locally with `wrangler dev`
- [ ] Verified health checks work on both upstreams
- [ ] Tested failover by stopping primary
- [ ] Enabled analytics (optional)
- [ ] Deployed with `wrangler publish`
- [ ] Updated client applications to use gateway URL
- [ ] Set up monitoring/alerting

---

## Supported Endpoints (Udemy Example)

### Public
- `GET /` - Cookie retrieval

### Health
- `GET /api/health` - Health check

### API (with `X-License-Key`)
- `GET /api/sync` - Sync all data
- `POST /api/init` - Initialize default folders
- `GET /api/folders` - Get folders
- `POST /api/folders` - Create folder
- `PUT /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder
- `POST /api/courses/add-to-folders` - Add course to multiple folders
- `POST /api/courses/migrate-host` - Migrate courses

### Admin (with `X-Admin-Key`)
- `GET /api/admin/stats` - Get statistics
- `GET /api/admin/licenses` - Get all licenses
- `POST /api/admin/licenses` - Create license
- `PUT /api/admin/licenses/:id` - Update license
- `DELETE /api/admin/licenses/:id` - Delete license

---

## Developer Reference

### Project Structure

```
cf-workers-api-gateway/
├── src/
│   ├── index.ts              # Main gateway logic
│   ├── config.json           # Route configuration
│   ├── origins/
│   │   ├── url.ts            # Simple URL origin
│   │   ├── proxyAll.ts       # Multi-project proxy
│   │   └── upstream WithFallback.ts
│   ├── policies/
│   │   ├── request/          # Request policies
│   │   └── response/         # Response policies
│   └── services/
│       └── analytics.ts      # Analytics tracking
├── wrangler.toml             # Cloudflare configuration
└── package.json
```

### Creating Custom Origins

```typescript
// src/origins/custom.ts
import { TOriginHandler } from "../types";

export const custom: TOriginHandler = async (request, options) => {
  // Your custom logic
  const response = await fetch(options.url);
  return response;
};
```

### Creating Custom Policies

```typescript
// src/policies/request/custom.ts
export const customAuth = async (request, options) => {
  const token = request.headers.get('Authorization');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  return request; // Pass through if valid
};
```

---

## Contributing

Contributions welcome! Areas for improvement:

- Wildcard path support (`/api/*`)
- Built-in rate limiting
- Request/response logging
- Metrics dashboard
- Load balancing strategies

---

## Support

- **Logs**: `npx wrangler tail`
- **Deployments**: `npx wrangler deployments list`
- **Rollback**: `npx wrangler rollback [deployment-id]`
- **Documentation**: [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

---

## License

MIT License - See LICENSE file for details

---

## Status

✅ **Production Ready**  
🚀 **Currently Deployed**: api-gateway.sitienbmt.workers.dev  
📊 **Projects**: 1 (Udemy API)  
⚡ **Uptime**: High Availability with Auto-Failover
