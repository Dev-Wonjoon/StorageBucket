
interface PhotoCardProps {
    title: string;
    imageUrl: string;
    date: string;
}

export const PhotoCard = ({ title, imageUrl, date }: PhotoCardProps) => {
    return (
        <div className="group relative rounded-lg overflow-hidden transition-all cursor-pointer hover:shadow-xl
                        bg-[--bg-sidebar] border border-[--border-line] hover:border-[--color-primary]">
            <div className="aspect-[4/3] overflow-hidden">
                <img
                    src={imageUrl}
                    alt={title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                </img>
            </div>

            <div className="p-3">
                <h3 className="font-semibold truncate text-[--text-main]">
                    {title}
                </h3>
                <p className="text-xs mt-1 text-[--text-muted]">
                    {date}
                </p>
            </div>
        </div>
    );
};