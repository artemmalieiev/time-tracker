// Small DOM helpers shared by the popup and the journal page. Text always goes in through
// textContent, never innerHTML, because titles and descriptions are typed in by the person.

interface Props {
  className?: string;

  dataset?: Record<string, string>;

  text?: string;

  title?: string;

  /**
   * The type attribute, for a button or an input.
   */
  type?: string;

  /**
   * The value attribute, for an input or an option.
   */
  value?: string;
}

/**
 * Creates an element with the given properties and children.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props, children: (Node | string)[]) {
  const element = document.createElement(tag);
  if (props.className !== undefined) {
    element.className = props.className;
  }
  if (props.text !== undefined) {
    element.textContent = props.text;
  }
  if (props.title !== undefined) {
    element.title = props.title;
  }
  if (props.type !== undefined) {
    element.setAttribute('type', props.type);
  }
  if (props.value !== undefined) {
    element.setAttribute('value', props.value);
  }
  if (props.dataset) {
    for (const entry of Object.entries(props.dataset)) {
      element.dataset[entry[0]] = entry[1];
    }
  }
  element.append(...children);
  return element;
}

/**
 * Finds an element by id and checks its type. A missing element means the page markup and the
 * script disagree, which is a bug, so we throw.
 */
export function byId<T extends HTMLElement>(id: string, type: new () => T) {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Expected #${id} to be a ${type.name}`);
  }
  return element;
}
