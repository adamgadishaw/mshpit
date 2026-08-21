// Keep this boundary behind React.lazy/import(). Native Skia and browser photo
// encoders belong to the composer workflow, never the feed's startup bundle.
export { default as MediaEditorWorkspace } from "./MediaEditorWorkspace";
export { default } from "./MediaEditorWorkspace";
