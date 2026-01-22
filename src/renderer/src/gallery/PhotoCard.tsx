
interface PhotoCardProps {
    title: string;
    imageUrl: string;
    date: string;
}

export const PhotoCard = ({ title, imageUrl, date}: PhotoCardProps) => {
return (
    <div className="group relative bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-blue-500 transition-all cursor-pointer hover:shadow-xl">
      {/* 이미지 영역 (비율 유지) */}
      <div className="aspect-[4/3] overflow-hidden">
        <img 
          src={imageUrl} 
          alt={title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
      </div>
      
      {/* 텍스트 정보 */}
      <div className="p-3">
        <h3 className="text-white font-semibold truncate">{title}</h3>
        <p className="text-slate-400 text-xs mt-1">{date}</p>
      </div>
    </div>
  );
}