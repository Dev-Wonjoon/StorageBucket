import { useState, useEffect, useCallback } from "react";
import { EngineStatus } from "src/shared/types";

export const useEngineSettingsViewModel = () => {
    const [engines, setEngines] = useState<Record<string, EngineStatus>>({});
    const [installing, setInstalling] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = useCallback(async () => {
        try {
            const status = await window.api.getEngineStatus();
            setEngines(status);
        } catch(error) {
            console.error('[EngineSettingsVM] Failed to fetch status:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const install = useCallback(async (engine: string) => {
        setInstalling(engine);
        try {
            const success = await window.api.installEngine(engine);
            if(success) await fetchStatus();
        } catch(error) {
            console.error(`[EngineSettingsVM] Failed to install ${engine}:`, error);
        } finally {
            setInstalling(null);
        }
    }, [fetchStatus]);

    return {
        engines,
        installing,
        loading,
        install
    };
};