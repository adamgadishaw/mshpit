import { useEffect, useRef, useState } from "react";

import { MAX_FOLLOWED_ARTISTS, artistFollowScope, isArtistFollowed, nextArtistFollowSelection, shouldOfferFanClubInvite } from "../../domain/artistFollowFanClub.mjs";

const emptyUi = (scope) => ({
  scope,
  busy: false,
  targetFollowing: null,
  joining: false,
  invite: false,
  error: "",
  notice: "",
});

export function useArtistFollowFanClub({
  accountId = null,
  artistKey = null,
  artistName,
  favoriteArtists,
  updateProfile,
  isMember = false,
  joinFanClub,
} = {}) {
  const followed = isArtistFollowed(favoriteArtists, artistName);
  const member = !!accountId && !!isMember;
  const scope = artistFollowScope(accountId, { artistKey, name: artistName });
  const [uiState, setUiState] = useState(() => emptyUi(scope));
  const ui = uiState.scope === scope ? uiState : emptyUi(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const actionRef = useRef({ scope, sequence: 0 });
  if (actionRef.current.scope !== scope) {
    actionRef.current = { scope, sequence: actionRef.current.sequence + 1 };
  }
  const memberRef = useRef({ scope, member });
  memberRef.current = { scope, member };

  const updateUi = (ownedScope, patch) => setUiState((current) => ({
    ...(current.scope === ownedScope ? current : emptyUi(ownedScope)),
    ...patch,
  }));
  const claimAction = () => {
    const operation = { scope, sequence: actionRef.current.sequence + 1 };
    actionRef.current = operation;
    return operation;
  };
  const ownsAction = (operation) => scopeRef.current === operation.scope
    && actionRef.current.scope === operation.scope
    && actionRef.current.sequence === operation.sequence;

  useEffect(() => {
    setUiState((current) => current.scope === scope ? current : emptyUi(scope));
  }, [scope]);

  const toggleFollow = async () => {
    if (!accountId || ui.busy || ui.joining || typeof updateProfile !== "function") return;
    const operation = claimAction();
    const targetFollowing = !followed;
    const selection = nextArtistFollowSelection(favoriteArtists, artistName, { following: targetFollowing });
    if (selection.limitReached) {
      updateUi(scope, {
        error: `You already follow ${MAX_FOLLOWED_ARTISTS} artists. Unfollow one before adding another.`,
        notice: "",
        invite: false,
      });
      return;
    }
    if (!selection.changed) return;

    updateUi(scope, { busy: true, targetFollowing, invite: false, error: "", notice: "" });
    let result;
    try {
      result = await updateProfile({ favoriteArtists: selection.artists });
    } catch {
      result = null;
    }
    if (!ownsAction(operation)) return;
    if (result?.ok !== true) {
      updateUi(scope, {
        busy: false,
        targetFollowing: null,
        error: targetFollowing
          ? `Could not follow ${artistName}. Check your connection and try again.`
          : `Could not unfollow ${artistName}. Check your connection and try again.`,
      });
      return;
    }

    const confirmedArtists = Array.isArray(result?.user?.favoriteArtists)
      ? result.user.favoriteArtists
      : selection.artists;
    const confirmedFollowing = isArtistFollowed(confirmedArtists, artistName);
    if (confirmedFollowing !== targetFollowing) {
      updateUi(scope, {
        busy: false,
        targetFollowing: null,
        error: `Could not update your follow for ${artistName}. Please try again.`,
      });
      return;
    }
    const currentMember = memberRef.current.scope === scope && memberRef.current.member;
    updateUi(scope, {
      busy: false,
      targetFollowing: null,
      invite: shouldOfferFanClubInvite({ followSucceeded: true, following: confirmedFollowing, member: currentMember }),
      error: "",
      notice: confirmedFollowing
        ? currentMember ? `Following ${artistName}. You are already in the Fan Club.` : ""
        : currentMember ? `You unfollowed ${artistName}. You are still in the Fan Club.` : `You unfollowed ${artistName}.`,
    });
  };

  const join = async () => {
    if (!accountId || ui.busy || ui.joining || typeof joinFanClub !== "function") return;
    const operation = claimAction();
    if (memberRef.current.scope === scope && memberRef.current.member) {
      updateUi(scope, { invite: false, error: "", notice: `You are already in the ${artistName} Fan Club.` });
      return;
    }
    updateUi(scope, { joining: true, error: "", notice: "" });
    let result;
    try {
      result = await joinFanClub(artistName);
    } catch {
      result = null;
    }
    if (!ownsAction(operation)) return;
    if (!result?.ok || !result?.joined) {
      updateUi(scope, {
        joining: false,
        error: `Could not join the ${artistName} Fan Club. Check your connection and try again.`,
      });
      return;
    }
    updateUi(scope, {
      joining: false,
      invite: false,
      error: "",
      notice: `You joined the ${artistName} Fan Club.`,
    });
  };

  return {
    ...ui,
    followed,
    member,
    toggleFollow,
    join,
    dismissInvite: () => updateUi(scope, { invite: false, error: "", notice: "" }),
  };
}
