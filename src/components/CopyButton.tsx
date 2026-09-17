import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
export function CopyButton({ text, label, successLabel = '복사 완료', onCopied, className = 'primary-button' }: {
  text: string; label: string; successLabel?: string; onCopied?: () => void; className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (manual) { dialog.current?.showModal(); textarea.current?.select() } }, [manual])
  function success() {
    setCopied(true); onCopied?.(); clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 3000)
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text); success()
    } catch {
      const previous = document.activeElement as HTMLElement | null
      const fallback = document.createElement('textarea')
      fallback.value = text
      fallback.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'
      document.body.append(fallback); fallback.select()
      let done = false
      try { done = document.execCommand('copy') } catch { /* Manual selection fallback. */ }
      fallback.remove(); previous?.focus()
      if (done) success()
      else setManual(true)
    }
  }
  function close() { dialog.current?.close(); setManual(false); trigger.current?.focus() }
  return <><button ref={trigger} type="button" className={className} onClick={copy}><Icon name={copied ? 'check' : 'copy'} /><span aria-live="polite">{copied ? successLabel : label}</span>{className.includes('primary') && <Icon name="arrow" />}</button>{manual && <dialog ref={dialog} className="copy-dialog" aria-label="내용 직접 복사" onCancel={event => { event.preventDefault(); close() }}><h2>내용을 직접 복사해주세요</h2><p>자동 복사를 사용할 수 없습니다. 아래 내용을 선택한 뒤 Ctrl+C / ⌘C를 누르거나, 모바일에서 길게 눌러 복사하세요.</p><textarea ref={textarea} readOnly value={text} aria-label="직접 복사할 내용" /><div className="dialog-actions"><button className="secondary-button" onClick={() => textarea.current?.select()}>전체 선택</button><button className="primary-button" onClick={() => { success(); close() }}>복사했어요</button><button className="text-button" onClick={close}>닫기</button></div></dialog>}</>
}
