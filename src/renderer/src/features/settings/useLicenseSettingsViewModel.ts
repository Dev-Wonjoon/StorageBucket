import { useCallback, useEffect, useState } from "react";


interface LicenseInfo {
    name: string;
    url: string;
    notice: string;
}

export const useLicenseSettingsViewModel = () => {
    const [licenses, setLicenses] = useState<LicenseInfo[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        window.api.getEngineLicenses()
            .then(setLicenses)
            .catch((error) => {
                console.error('[LicenseSettingsVM] Failed to fetch licenses:', error);
            })
    }, []);

    const toggle = useCallback((name: string) => {
        setExpanded(prev => prev === name ? null : name);
    }, []);

    return {
        licenses,
        expanded,
        toggle,
    };
};
