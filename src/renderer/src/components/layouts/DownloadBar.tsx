import { useState } from "react";

interface DownloadBarProps {
    onStartDownload?: (url: string) => void;
}

export const DownloadBar = ({ onStartDownload }: DownloadBarProps) => {
    const [ url, setUrl ] = useState('');
    const [isChecking, setIsChecking] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!url.trim()) return

        setIsChecking(true);
    }
}