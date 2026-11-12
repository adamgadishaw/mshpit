import { Linking } from 'react-native';
import { createNativeStartupLinks } from './nativeStartupLinkBuffer.mjs';

let startup;
export function startNativeStartupLinkCapture() {
  startup ||= createNativeStartupLinks(Linking);
}
export function startupLinkingFor(consumer, owner) {
  startNativeStartupLinkCapture();
  return startup.forConsumer(consumer, owner);
}
