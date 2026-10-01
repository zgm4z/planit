import type { DateStr, SchedulingDirection } from '../domain/model/types'
import type { CommandHandler } from './types'

export interface ProjectRenamePayload {
  name: string
}

export interface ProjectSetDirectionPayload {
  direction: SchedulingDirection
}

export interface ProjectSetStartDatePayload {
  startDate: DateStr
}

/** endDate 传 undefined 即「清空锚点」（forward 下变为无期限） */
export interface ProjectSetEndDatePayload {
  endDate: DateStr | undefined
}

export const projectHandlers: Record<string, CommandHandler<any>> = {
  'project.rename': (draft, payload: ProjectRenamePayload) => {
    draft.name = payload.name
  },

  'project.setDirection': (draft, payload: ProjectSetDirectionPayload) => {
    draft.schedulingDirection = payload.direction
  },

  'project.setStartDate': (draft, payload: ProjectSetStartDatePayload) => {
    draft.startDate = payload.startDate
  },

  'project.setEndDate': (draft, payload: ProjectSetEndDatePayload) => {
    draft.endDate = payload.endDate
  },
}
