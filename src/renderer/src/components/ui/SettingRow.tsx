import { ReactNode } from "react";

interface SettingRowProps {
    label: string;
    value?: string;
    description?: string;
    action?: ReactNode
    status?: 'success' | 'error';
}

export const SettingRow = ({ label, value, description, action, status }: SettingRowProps) => {
    return (
        <div className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {status && (
                    <div className={`w-2 h-2 rounded-full flex-none ${
                        status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
                    }`} />
                )}
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[--text-main]">{label}</p>
                    {(value || description) && (
                        <p className="text-xs text-[--text-muted] truncate mt-0.5">
                            {value || description}
                        </p>
                    )}
                </div>
            </div>

            {action && (
                <div className="flex-none">{action}</div>
            )}
        </div>
    );
}