function App() {
  return (
    <div className="h-screen w-full bg-slate-900 flex flex-col items-center justify-center text-white">
      
      <div className="p-10 border border-slate-700 rounded-2xl bg-slate-800 shadow-xl text-center">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-4">
          Electron + Tailwind v4
        </h1>
        <p className="text-slate-400 text-lg mb-6">
          성공적으로 실행되었습니다! 🚀
        </p>
        
        <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-all active:scale-95">
          클릭 테스트
        </button>
      </div>

    </div>
  )
}

export default App