# Photo handoff to POS

Stock receiving records a durable photo task in POS migration 107. Image copying follows the completed receipt and cannot reverse it. The catalog original remains unchanged; POS receives an immutable content-addressed copy under its own image namespace.

Open a receipt, choose **View lot and photo**, and inspect the image status. Failed or interrupted transfers offer **Retry photo transfer**. This request only repairs imagery. Existing POS imagery is kept, including manually chosen primary images; successful retries never receive stock again.

Implementation: POS ADR-076, package 0.5.0. Verified with real PostgreSQL, authenticated POS routes, concurrent retries, protected imagery and desktop/mobile recovery. The browser fixture retains real image bytes while substituting external bucket I/O. Live bucket acceptance remains part of staging.
