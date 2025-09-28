import express from "express";

const router = express.Router();

const checkUclanConnectivity = async (): Promise<{ status: string; responseTime?: number; error?: string }> => {
    const startTime = Date.now();

    try {
        const response = await fetch("https://apps.uclan.ac.uk/MvCRoomTimetable/", {
            method: "HEAD",
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            signal: AbortSignal.timeout(10000)
        });

        const responseTime = Date.now() - startTime;

        if (response.ok) {
            return {
                status: "healthy",
                responseTime
            };
        } else {
            return {
                status: "unhealthy",
                responseTime,
                error: `HTTP ${response.status}: ${response.statusText}`
            };
        }
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
            status: "unhealthy",
            responseTime,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
};

router.get("/health", async (req, res) => {
    try {
        const uclanCheck = await checkUclanConnectivity();

        const healthStatus = {
            server: {
                status: "healthy",
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            },
            uclan: uclanCheck,
            overall: uclanCheck.status === "healthy" ? "healthy" : "degraded"
        };

        const statusCode = healthStatus.overall === "healthy" ? 200 : 503;
        res.status(statusCode).json(healthStatus);

    } catch (error) {
        res.status(500).json({
            server: {
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            },
            uclan: {
                status: "unknown",
                error: "Health check failed"
            },
            overall: "unhealthy",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

export default router;