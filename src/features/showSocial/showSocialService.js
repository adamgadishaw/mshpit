import { api } from "../../lib/api";
import {
  readShowCrowdAttendance as readShowCrowdAttendanceWithApi,
  readShowDocument as readShowDocumentWithApi,
  readShowLoungeMeta as readShowLoungeMetaWithApi,
  writeShowAttendance as writeShowAttendanceWithApi,
} from "./showSocialApi.mjs";

// Screens consume domain-named operations; only this feature boundary owns the
// shared PIT transport and its authenticated-cookie semantics.
export const readShowCrowdAttendance = (options) => readShowCrowdAttendanceWithApi(options, { apiCall: api });

export const readShowDocument = (options) => readShowDocumentWithApi(options, { apiCall: api });

export const readShowLoungeMeta = (options) => readShowLoungeMetaWithApi(options, { apiCall: api });

export const writeShowAttendance = (options) => writeShowAttendanceWithApi(options, { apiCall: api });
