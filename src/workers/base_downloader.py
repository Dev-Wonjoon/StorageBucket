from typing import Callable, Dict

class BaseDownloader:
    """
    모든 다운로더 클래스가 상속받아야 할 기본 클래스입니다.
    __call__ 메서드를 구현하여 클래스 인스턴스가 함수처럼 실행될 수 있도록 합니다.
    """
    def __init__(self, url: str, source: str, progress_callback: Callable[[Dict], None]):
        self.url = url
        self.source = source
        self.progress_callback = progress_callback

    def __call__(self) -> Dict:
        """
        이 메서드를 오버라이드하여 실제 다운로드 로직을 구현해야 합니다.
        성공 시 메타데이터 딕셔너리를 반환해야 합니다.
        """
        raise NotImplementedError("모든 다운로더는 __call__ 메서드를 구현해야 합니다.")