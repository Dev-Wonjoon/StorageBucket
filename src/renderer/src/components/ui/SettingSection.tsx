import { ReactNode } from "react";

interface SettingSectionProps {
    title: string;
    description?: string;
    children: ReactNode;
}

export const SettingSection = ({ title, description, children }: SettingSectionProps) => {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-[--text-main]">{title}</h2>
                {description && (
                    <p className="text-sm text-[--text-muted] mt-1">{description}</p>
                )}
            </div>

            <div className="rounded-lg border border-[--border-line] divide-y divide-[--border-line]">
                {children}
            </div>
        </div>
    );
};