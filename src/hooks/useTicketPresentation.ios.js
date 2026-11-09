import { useLayoutEffect, useMemo, useRef, useState } from "react";
import showIOSPostActions from "../components/showIOSPostActions";

function animate(image, play) {
  // A native image can disappear between commit and command delivery.
  try { image?.[play ? "startAnimating" : "stopAnimating"]?.()?.catch?.(() => {}); } catch {
    // architecture: allow-empty-catch -- A detached native image cannot receive animation commands; its removed view needs no recovery and must not interrupt navigation cleanup.
  }
}

// A retained card keeps its view, never a previous presentation's authority.
export default function useTicketPresentation({ menuScope, userId, contextActions, contextPresentation, mediaViewable, tabPreview, reduceMotion, closeMenu, confirmDelete }) {
  const presentedCard = contextPresentation != null || mediaViewable != null || tabPreview;
  const cardVisible = !tabPreview && mediaViewable !== false && contextPresentation?.current() !== false;
  const scope = JSON.stringify([menuScope, userId, contextActions.map(action => action.label), cardVisible]);
  const owner = useRef({ scope, presentation: contextPresentation, generation: 0, actions: contextActions });
  const sheetOpen = useRef(null);
  if (owner.current.scope !== scope || owner.current.presentation !== contextPresentation) {
    owner.current.generation++;
    sheetOpen.current = null;
    closeMenu();
  }
  owner.current.scope = scope;
  owner.current.presentation = contextPresentation;
  owner.current.actions = contextActions;
  const mounted = useRef(true);
  const everMounted = useRef(false);
  const [, refreshOwner] = useState(0);
  useLayoutEffect(() => {
    mounted.current = true;
    if (everMounted.current) refreshOwner(value => value + 1);
    everMounted.current = true;
    return () => { mounted.current = false; owner.current.generation++; sheetOpen.current = null; };
  }, []);
  const generation = owner.current.generation;
  const current = () => mounted.current && owner.current.generation === generation
    && cardVisible && contextPresentation?.current() !== false;
  const actionPresentation = useMemo(() => ({ current }), [generation]);
  const campaignImage = useRef(null);
  const motionAllowed = useRef(!reduceMotion);
  motionAllowed.current = !reduceMotion;
  // SDK57 autoplay controls image assignment. Stop an already-running GIF too.
  useLayoutEffect(() => {
    const image = campaignImage.current;
    animate(image, current() && !reduceMotion);
    return () => animate(image, false);
  }, [generation, reduceMotion]);
  const onDisplay = () => {
    if (owner.current.generation === generation) animate(campaignImage.current, current() && motionAllowed.current);
  };
  const guard = callback => presentedCard && typeof callback === "function"
    ? (...args) => { if (current()) return callback(...args); }
    : callback;
  const openContextActions = () => {
    if (!current() || sheetOpen.current || !contextActions.length) return;
    const labels = contextActions.map(action => action.label);
    const sheet = {};
    sheetOpen.current = sheet;
    closeMenu();
    showIOSPostActions({
      title: "Post actions", options: [...labels, "Cancel"], cancelButtonIndex: labels.length,
      destructiveButtonIndex: labels.includes("Delete post") ? labels.indexOf("Delete post") : undefined,
    }, index => {
      if (sheetOpen.current !== sheet) return;
      sheetOpen.current = null;
      if (!current()) return;
      const selected = owner.current.actions[index];
      if (selected && selected.label === labels[index]) {
        if (selected.label === "Delete post") confirmDelete(current);
        else selected.run();
      }
    });
  };
  return { current, guard, cardVisible, openContextActions, campaignImageProps: { ref: campaignImage, onDisplay },
    actionProps: presentedCard ? { actionPresentation } : {},
    shareKey: presentedCard ? `share:${generation}` : undefined,
  };
}
