# EduOp CRM landing page

The landing page includes a contact section that sends enquiries through the Resend HTTPS API. Messages go to `shopifyorchis@gmail.com` by default, and replies go to the visitor's email address.

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm start
```

Open `http://localhost:8080`. To test real delivery, create a local `.env` using the variable names in `.env.example`. Keep the API key private. The page runs without email credentials, but the form reports that sending is unavailable until configured.

## Railway setup

Deploy this repository as a Railway service. It serves both the landing page and the email endpoint.

- Railway automatically detects the included `Dockerfile`, which starts `node server.js`.
- If the service has a custom start command, clear it to use the Dockerfile default or set it to `node server.js`.
- Set the health check path to `/healthz` in the service's deployment settings.
- The server binds to Railway's `PORT` on `0.0.0.0`. If your public domain has an explicit target port, it must match the service's `PORT` (8080 by default).
- The server recognizes Railway's built-in `RAILWAY_PROJECT_ID` and uses its edge headers for the visitor IP and public host.

Open your Railway project, select the service hosting this landing page, then open **Variables** and add:

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | A private Resend API key with sending access |
| `CONTACT_FROM_EMAIL` | A plain address on a domain verified in Resend, such as `contact@yourdomain.com` |
| `CONTACT_TO_EMAIL` | `shopifyorchis@gmail.com` |

Apply the staged variable changes and deploy the updated code. Gmail is the receiving inbox; it is not the verified sending domain. The old `nginx.conf` is no longer used by the Dockerfile. No keys are embedded in browser code or included in the container image.

Railway references: [variables](https://docs.railway.com/variables), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), and [edge request headers](https://docs.railway.com/networking/public-networking/specs-and-limits).

The form validates required details, preserves input on failure, blocks a hidden spam field, and limits each client to five requests per 15 minutes. Rate limits are stored in memory for a single service instance and reset when it restarts. Configure a shared rate-limit store if deploying multiple instances.

## Verification

```sh
npm test
```

Tests use a mocked Resend transport, so they do not send email. After setting a verified sender and key, submit a real enquiry on the deployed site and confirm receipt in the inbox.
