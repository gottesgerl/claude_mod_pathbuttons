import type { ClientModule } from 'claude-code'

// An invisible region over one of the band's buttons: it reports the pointer coming and going
// (the hooks module shows a short dim hint meanwhile) and a left click (the button's action).
type Props = { id: string }

const Hover: ClientModule<Props> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'enter' || event.type === 'leave') {
      surface.post({ action: event.type, id: props.id })
    } else if (event.type === 'down' && event.button === 'left') {
      surface.post({ action: 'press', id: props.id })
    }
  })
  return <Text>{' '}</Text>
}

export default Hover
