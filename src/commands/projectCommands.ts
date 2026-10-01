import type { CommandHandler } from './types'

export interface ProjectRenamePayload {
  name: string
}

export const projectHandlers: Record<string, CommandHandler<any>> = {
  'project.rename': (draft, payload: ProjectRenamePayload) => {
    draft.name = payload.name
  },
}
