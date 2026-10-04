/** 焦点落在这些原生标签里时视为「正在输入」 */
export const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'] as const

/**
 * 焦点是否落在可编辑控件里（输入框 / 文本域 / 下拉 / contenteditable）。
 *
 * **同一规则只此一处实现**：工具栏的撤销/重做快捷键与甘特的缩放快捷键都调它。
 * （Mantine 的 TextInput / NumberInput / DateInput / Select 都渲染成原生控件，一并覆盖。）
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return (EDITABLE_TAGS as readonly string[]).includes(target.tagName)
}
