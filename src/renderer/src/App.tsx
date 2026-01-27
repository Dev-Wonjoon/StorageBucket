import { useState } from "react"
import { Sidebar } from "./components/layouts/Sidebar"
import { DownloadBar } from "./components/layouts/DownloadBar";
import { GalleryPage } from "./features/gallery/GalleryPage";

function App() {
	const [activeMenu, setActiveMenu] = useState('gallery');
	return (
		<div className="flex h-screen w-full bg-[--bg-app] text-[--text-main] overflow-hidden font-sans transition-colors duration-200">
			{/* 좌측 사이드 바 */}
			<div className="w-64 flex-none h-full border-r border-[--border-line]">
				<Sidebar activeMenu={activeMenu} onMenuClick={setActiveMenu}/>
			</div>

			{/* 메인 갤러리 영역 */}
			<div className="flex-1 flex flex-col h-full min-w-0">
			{/* 상단 다운로드 바 */}
				<div className="flex-none p-4 border-b border-[border-line] bg-[--bg-app]/95 backdrop-blur-sm z-10">
					<DownloadBar onStartDownload={(url) => console.log('Download:', url)}/>
				</div>		

				{/* 갤러리 영역 */}
				<div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-[--bg-active] scrollbar-track-transparent">
					{activeMenu === 'gallery' && <GalleryPage />}

					{activeMenu === 'search' && (
						<div className="flex items-center justify-center h-full text-[--text-muted]">
							검색기능 준비 중...
						
						</div>
					)}

					{activeMenu === 'favorites' && (
						<div className="flex items-center justify-center h-full text-[--text-muted]">
							즐겨찾기 준비 중...
						</div>
					)}
					{activeMenu === 'settings' && (
						<div className="flex items-center justify-center h-full text-[--text-muted]">
							설정 준비 중...
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default App