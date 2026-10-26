export function confirmDiscard(dirty: boolean): boolean {
    return !dirty || window.confirm('작성 중인 제목·태그를 버리고 이동하거나 상세를 닫을까요?')
}
