import { useState } from "react"
import { Sidebar } from "./components/layouts/Sidebar"
import { DownloadBar } from "./components/layouts/DownloadBar";
import { GalleryPage } from "./features/gallery/GalleryPage";

function App() {
	const [activeMenu, setActiveMenu] = useState('gallery');

	const handleDownload = async (url: string) => {
		console.log('[App] Download started for:', url);

		try{
			const result = await window.api.downloadVideo(url);

			if(result.success) {
				console.log('[App] Download Complete: ', result.data);
				window.dispatchEvent(new Event('gallery-refresh'));
				console.log('Download and DB storage complete')
				alert('다운로드가 완료되었습니다');
			} else {
				console.error('[App] Download Failed:', result.error);
				alert(`다운로드 실패: ${result.error}`);
			}
		} catch(error) {
			console.error('[App] Communication Error:', error);
		}
	}

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