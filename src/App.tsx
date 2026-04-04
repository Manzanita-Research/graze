import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import {
  Tldraw,
  Editor,
  useEditor,
  DefaultHorizontalAlignStyle,
} from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || ''
const HOOK_TOKEN = import.meta.env.VITE_HOOK_TOKEN || ''

const TOOLS = [
  { id: 'select', label: 'Select', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
  )},
  { id: 'draw', label: 'Draw', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
  )},
  { id: 'eraser', label: 'Eraser', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 21h10"/><path d="M5.5 11.5L16 2l6 6-10.5 10.5a2 2 0 01-1.4.6H5.6a2 2 0 01-1.4-.6L2.5 16.8a2 2 0 010-2.8l3-2.5z"/></svg>
  )},
  { id: 'hand', label: 'Hand', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 00-4 0v4"/><path d="M14 10V4a2 2 0 00-4 0v7"/><path d="M10 10.5V6a2 2 0 00-4 0v8"/><path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.5 0-4.5-1-6.2-2.8L3 16"/></svg>
  )},
  { id: 'text', label: 'Text', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
  )},
  { id: 'note', label: 'Sticky Note', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z"/><polyline points="14 3 14 9 21 9"/></svg>
  )},
  { id: 'geo', label: 'Rectangle', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
  )},
  { id: 'line', label: 'Line', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>
  )},
  { id: 'arrow', label: 'Arrow', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
  )},
  { id: 'highlight', label: 'Highlight', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/></svg>
  )},
]

/** Zoom helpers: two-finger double-tap resets to 100%, pinch snaps through 100% */
function ZoomHelper() {
  const editor = useEditor()

  useEffect(() => {
    const container = editor.getContainer()

    // --- Two-finger double tap to reset zoom ---
    // Track two-finger taps as: touchstart with 2 fingers → touchend with 0 remaining, short duration
    let twoFingerStart = 0
    let lastTwoFingerTap = 0
    let tapCenter = { x: 0, y: 0 }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        twoFingerStart = Date.now()
        tapCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        }
      } else {
        twoFingerStart = 0
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length !== 0 || !twoFingerStart) return
      const duration = Date.now() - twoFingerStart
      if (duration > 300) { twoFingerStart = 0; return } // too long, not a tap

      const now = Date.now()
      if (now - lastTwoFingerTap < 500) {
        lastTwoFingerTap = 0
        twoFingerStart = 0
        editor.resetZoom(tapCenter, { animation: { duration: 200 } })
      } else {
        lastTwoFingerTap = now
      }
      twoFingerStart = 0
    }

    // --- Zoom detent at 100% during pinch ---
    const DETENT = 0.04
    let prevZoom = editor.getZoomLevel()
    let snappedAt100 = false

    const unsub = editor.store.listen(() => {
      const zoom = editor.getZoomLevel()
      if (zoom === prevZoom) return

      const crossed = (prevZoom < 1 && zoom > 1) || (prevZoom > 1 && zoom < 1)
      const near100 = Math.abs(zoom - 1) < DETENT

      if ((crossed || near100) && !snappedAt100) {
        snappedAt100 = true
        const cam = editor.getCamera()
        editor.setCamera({ x: cam.x, y: cam.y, z: 1 }, { immediate: true })
      } else if (Math.abs(zoom - 1) > DETENT * 2) {
        snappedAt100 = false
      }

      prevZoom = editor.getZoomLevel()
    })

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
      unsub()
    }
  }, [editor])

  return null
}

function ToolDock({ onClear, onPush, pushing, status }: {
  onClear: () => void
  onPush: () => void
  pushing: boolean
  status: 'idle' | 'success' | 'error'
}) {
  const editor = useEditor()
  const [currentTool, setCurrentTool] = useState('draw')
  const [penMode, setPenMode] = useState(() => editor.getInstanceState().isPenMode)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTool(editor.getCurrentToolId())
      setPenMode(editor.getInstanceState().isPenMode)
    }, 100)
    return () => clearInterval(interval)
  }, [editor])

  const togglePenMode = useCallback(() => {
    const next = !editor.getInstanceState().isPenMode
    editor.updateInstanceState({ isPenMode: next })
    setPenMode(next)
  }, [editor])

  return (
    <div className="clawpad-dock">
      <span className="dock-logo"><span>G</span>P</span>
      <button
        className={`dock-btn dock-pen-toggle ${penMode ? 'active' : ''}`}
        onClick={togglePenMode}
        title={penMode ? 'Pen mode (touch ignored)' : 'Touch mode (all input)'}
      >
        {penMode ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 00-4 0v4"/><path d="M14 10V4a2 2 0 00-4 0v7"/><path d="M10 10.5V6a2 2 0 00-4 0v8"/><path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.5 0-4.5-1-6.2-2.8L3 16"/></svg>
        )}
      </button>
      <div className="dock-divider" />
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`dock-btn dock-tool ${currentTool === tool.id ? 'active' : ''}`}
          onClick={() => editor.setCurrentTool(tool.id)}
          title={tool.label}
        >
          {tool.icon}
        </button>
      ))}
      <div className="dock-spacer" />
      <div className="dock-divider" />
      <button className="dock-btn" onClick={onClear} title="Clear canvas">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>
      <button
        className={`dock-btn dock-btn-push ${status}`}
        onClick={onPush}
        disabled={pushing}
        title={pushing ? 'Pushing…' : 'Push to OpenClaw'}
      >
        {pushing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
        )}
      </button>
      {status !== 'idle' && (
        <span className={`dock-status ${status}`}>
          {status === 'success' ? '✓' : '✗'}
        </span>
      )}
    </div>
  )
}

function App() {
  const editorRef = useRef<Editor | null>(null)
  const [pushing, setPushing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const options = useMemo(() => ({
    gridSteps: [
      { min: -1, mid: 0.15, step: 20 },
      { min: 0.05, mid: 0.375, step: 8 },
      { min: 0.15, mid: 1, step: 4 },
      { min: 0.7, mid: 2.5, step: 1 },
    ],
  }), [])

  // Daylight DC-1 action button (keyCode 123)
  // Single press, double press, and long hold — gestures TBD
  useEffect(() => {
    const ACTION_KEY = 123
    const DOUBLE_WINDOW = 400
    const HOLD_THRESHOLD = 600

    let pressCount = 0
    let clickTimer: ReturnType<typeof setTimeout> | null = null
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let held = false

    const onActionSingle = () => {
      console.log('[GoatPad] action: single press')
      handlePush()
    }
    const onActionDouble = () => {
      console.log('[GoatPad] action: double press')
      // TODO: wire up
    }
    const onActionHold = () => {
      console.log('[GoatPad] action: hold')
      // TODO: wire up
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode !== ACTION_KEY || e.repeat) return
      e.preventDefault()

      held = false
      holdTimer = setTimeout(() => {
        held = true
        pressCount = 0
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
        onActionHold()
      }, HOLD_THRESHOLD)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.keyCode !== ACTION_KEY) return
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
      if (held) return // already fired hold

      pressCount++
      if (clickTimer) clearTimeout(clickTimer)
      clickTimer = setTimeout(() => {
        if (pressCount >= 2) {
          onActionDouble()
        } else {
          onActionSingle()
        }
        pressCount = 0
        clickTimer = null
      }, DOUBLE_WINDOW)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (clickTimer) clearTimeout(clickTimer)
      if (holdTimer) clearTimeout(holdTimer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    editor.updateInstanceState({ isGridMode: true, isPenMode: true })
    editor.setCurrentTool('draw')
    editor.setStyleForNextShapes(DefaultHorizontalAlignStyle, 'middle')

    // Keep highlight strokes underneath all other shapes
    editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
      if (next.type === 'highlight' && !prev.props.isComplete && next.props.isComplete) {
        editor.sendToBack([next.id])
      }
    })
    editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
      if (shape.type === 'highlight') {
        editor.sendToBack([shape.id])
      }
    })
  }, [])

  const handlePush = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    const shapeIds = editor.getCurrentPageShapeIds()
    if (shapeIds.size === 0) {
      alert('Draw something first!')
      return
    }

    if (!HOOK_TOKEN) {
      alert('No VITE_HOOK_TOKEN configured. Check your .env file.')
      return
    }

    setPushing(true)
    setStatus('idle')

    try {
      const result = await editor.toImage([...shapeIds], {
        format: 'png',
        pixelRatio: 2,
        background: true,
        padding: 32,
      })

      if (!result) throw new Error('Export failed')

      const formData = new FormData()
      formData.append('sketch', result.blob, `goatpad-${Date.now()}.png`)

      const saveResponse = await fetch(`${GATEWAY_URL}/clawpad/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!saveResponse.ok) throw new Error(`Upload failed: ${saveResponse.status}`)

      const { path: savedPath } = await saveResponse.json()

      const hookResponse = await fetch(`${GATEWAY_URL}/hooks/agent`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HOOK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `🐾 Celeste pushed a sketch from GoatPad! Image saved at: ${savedPath} — please analyze this sketch and respond.`,
          name: 'GoatPad',
          sessionKey: 'hook:clawpad',
          deliver: true,
          channel: 'telegram',
        }),
      })

      if (!hookResponse.ok) throw new Error(`Hook failed: ${hookResponse.status}`)

      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      console.error('Push failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 5000)
    } finally {
      setPushing(false)
    }
  }, [])

  const handleClear = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const shapeIds = editor.getCurrentPageShapeIds()
    if (shapeIds.size === 0) return
    editor.deleteShapes([...shapeIds])
  }, [])

  return (
    <div className="clawpad">
      <div className="canvas">
        <Tldraw
          persistenceKey="clawpad-canvas"
          onMount={handleMount}
          options={options}
          components={{
            HelpMenu: null,
            DebugPanel: null,
            DebugMenu: null,
            MenuPanel: null,
            PageMenu: null,
            NavigationPanel: null,
            Minimap: null,
            Toolbar: null,
            HelperButtons: null,
          }}
        >
          <ZoomHelper />
          <ToolDock
            onClear={handleClear}
            onPush={handlePush}
            pushing={pushing}
            status={status}
          />
        </Tldraw>
      </div>
    </div>
  )
}

export default App
