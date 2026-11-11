import type { ClientModule } from 'claude-code'

// One path's pressable region in the band: a symbol, or nothing over a preview.
// Left click opens the path, right click shows it; the hooks module does both on the post.
type Props = { path: string; label: string }

const Hit: ClientModule<Props> = (props, surface) => {
  const { Text } = surface.elements
  // Set again on every call, so the listener always knows the path drawn now.
  surface.onPointer(event => {
    // Over and away: the hooks module shows the file name dim in the band meanwhile.
    if (event.type === 'enter' || event.type === 'leave') {
      surface.post({ action: event.type, path: props.path })
      return
    }
    if (event.type !== 'down') {
      return
    }
    if (event.button === 'right') {
      surface.post({ action: 'show', path: props.path })
    } else if (event.button === 'left') {
      surface.post({ action: 'open', path: props.path })
    }
  })
  return <Text>{props.label}</Text>
}

export default Hit
