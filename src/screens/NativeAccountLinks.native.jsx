import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';
import { colors } from '../theme';
import { apiBaseForRuntime } from '../domain/apiOrigin.mjs';
import { connectNativeAccountLinks } from '../domain/nativeAccountLink.mjs';
import VerifyEmailScreen from './VerifyEmailScreen';
import ResetPasswordScreen from './ResetPasswordScreen';
import InvalidAccountLinkScreen from './InvalidAccountLinkScreen';
import AuthScreen from './AuthScreen';

const origin = apiBaseForRuntime({ platform: 'native', configuredOrigin: process.env.EXPO_PUBLIC_API_URL,
  development: typeof __DEV__ !== 'undefined' && __DEV__ });
export default function NativeAccountLinks({ onActiveChange, onEnter }) {
  const { authReady, session } = useStore();
  const [flow, setFlow] = useState(null);
  const inbox = useRef(null), abort = useRef(null), callbacks = useRef(null);
  callbacks.current = { onEnter, onActiveChange };
  const close = () => inbox.current?.close();
  useEffect(() => {
    const controller = connectNativeAccountLinks({ linking: Linking, origin,
      onIntent: next => { callbacks.current.onEnter?.(); setFlow(next); },
      onInvalidate: event => {
        abort.current?.();
        if (event.reason === 'validation') return;
        const nextFlow = event.reason === 'identity' && event.kind === 'reset'
          ? { kind: 'interrupted', accountId: event.accountId, revision: -1 } : null;
        // An intent can be retired before its first visible render. Publish
        // activity here too; a false-to-false visibility effect will not rerun.
        callbacks.current.onActiveChange?.(!!nextFlow);
        setFlow(nextFlow);
      },
      onUnavailable: () => console.warn('Incoming account link could not be read. Open the email link again.'),
    });
    inbox.current = controller;
    controller.setIdentity(authReady, session?.id);
    return () => { controller.dispose(); inbox.current = null; };
  }, []);
  useLayoutEffect(() => { inbox.current?.setIdentity(authReady, session?.id); }, [authReady, session?.id]);
  // Hide an old owner's form before effects run during a handoff.
  const visible = flow && flow.accountId === (session?.id || null) ? flow : null;
  useLayoutEffect(() => { callbacks.current.onActiveChange?.(!!visible); }, [!!visible]);
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [!!visible]);
  const recover = kind => { inbox.current?.retire(); abort.current?.(); setFlow(current => current ? { ...current, kind, token: undefined } : null); };
  if (!visible) return null;
  const props = { navigationAbortRef: abort,
    onAccepted: () => { inbox.current?.retire(); abort.current = null; setFlow(null); }, onDone: close, onCancel: close, onClose: close,
    onLogin: () => recover('login'), onRequestReset: () => recover('forgot') };
  return <View style={styles.overlay} accessibilityViewIsModal>
    <View style={{ flex: 1 }} pointerEvents={authReady ? 'auto' : 'none'} accessibilityElementsHidden={!authReady} importantForAccessibility={authReady ? 'auto' : 'no-hide-descendants'}>
    {visible.kind === 'verify' ? <VerifyEmailScreen key={visible.revision} {...props} token={visible.token} />
      : visible.kind === 'reset' ? <ResetPasswordScreen key={visible.revision} {...props} token={visible.token} />
      : visible.kind === 'invalid' ? <InvalidAccountLinkScreen {...props} />
      : visible.kind === 'interrupted' ? <View style={{padding:24,gap:16}}>
        <Text style={{color:colors.text,fontSize:20}}>Your account changed</Text>
        <Text style={{color:colors.text}}>The reset form was closed. If you submitted a new password, it may already have been saved. Try logging in with it, or request a fresh reset link.</Text>
        <Pressable onPress={props.onLogin} accessibilityRole="button" style={{minHeight:48,justifyContent:'center'}}><Text style={{color:colors.amber}}>Go to log in</Text></Pressable>
        <Pressable onPress={props.onRequestReset} accessibilityRole="button" style={{minHeight:48,justifyContent:'center'}}><Text style={{color:colors.amber}}>Request a new reset link</Text></Pressable>
        <Pressable onPress={close} accessibilityRole="button" style={{minHeight:48,justifyContent:'center'}}><Text style={{color:colors.amber}}>Close</Text></Pressable>
      </View> : <AuthScreen key={visible.kind} {...props} initialMode={visible.kind} />}
    </View>
    {!authReady && <View style={[styles.overlay,{alignItems:"center",justifyContent:"center"}]}><ActivityIndicator accessibilityLabel="Checking your account"/><Text style={{color:colors.text}}>Checking your account...</Text></View>}
  </View>;
}
const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, backgroundColor: colors.bg } });
