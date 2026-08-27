import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useStore } from "../store";
import { artistMeta } from "../seed/ingested";
import { artistWorkspaceModel } from "../domain/artistWorkspace.mjs";
import { artistPageEditReady } from "../domain/artistPageEditor.mjs";
import { formatDate } from "../domain/dates.mjs";
import {
  beginLoadState,
  createLoadState,
  projectLoadState,
  rejectLoadState,
  resolveLoadState,
} from "../domain/loadState.mjs";
import { accountTargetScope } from "../domain/screenScope.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Icon from "../components/Icon";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";

const UPDATE_LIMIT = 1000;

function Eyebrow({ children, tone = colors.amber }) {
  return <Text style={[styles.eyebrow, { color: tone }]}>{children}</Text>;
}

function SectionTitle({ eyebrow, title, detail, right }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionCopy}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        {!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}
      </View>
      {right}
    </View>
  );
}

function MiniStat({ icon, value, label, accent = colors.amber }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: accent + "1F" }]}>
        <Icon name={icon} size={16} color={accent} strokeWidth={2.3} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionTile({ icon, title, detail, onPress, accent = colors.amber, disabled = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ disabled }}
      style={({ pressed, focused }) => [styles.actionTile, disabled && styles.actionTileDisabled, pressed && !disabled && styles.pressed, focused && !disabled && focusRing]}
    >
      <View style={[styles.actionIcon, { backgroundColor: accent + "1A", borderColor: accent + "4D" }]}>
        <Icon name={icon} size={20} color={accent} strokeWidth={2.2} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Icon name="chevron-right" size={17} color={colors.textFaint} />
    </Pressable>
  );
}

function CompletionRow({ item, onPress }) {
  return (
    <Pressable
      onPress={item.complete ? null : onPress}
      disabled={item.complete}
      accessibilityRole={item.complete ? "text" : "button"}
      accessibilityLabel={`${item.label}. ${item.complete ? "Complete" : "Needs attention"}`}
      style={({ pressed, focused }) => [styles.completionRow, pressed && !item.complete && styles.completionPressed, focused && !item.complete && focusRing]}
    >
      <View style={[styles.completionMark, item.complete && styles.completionMarkDone]}>
        <Icon name={item.complete ? "check" : "plus"} size={13} color={item.complete ? "#07150E" : colors.textDim} strokeWidth={2.6} />
      </View>
      <View style={styles.completionCopy}>
        <Text style={[styles.completionTitle, item.complete && styles.completionTitleDone]}>{item.label}</Text>
        {!item.complete && <Text style={styles.completionDetail}>{item.detail}</Text>}
      </View>
      {!item.complete && <Icon name="chevron-right" size={15} color={colors.textFaint} />}
    </Pressable>
  );
}

function Unauthorized({ onClose }) {
  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="ARTIST HQ" title="Backstage access" onBack={onClose} />
      <View style={styles.denied}>
        <View style={styles.deniedIcon}><Icon name="lock" size={28} color={colors.amber} /></View>
        <Text style={styles.deniedTitle}>This room is for verified artists</Text>
        <Text style={styles.deniedCopy}>Sign in with an approved artist account to manage its public artist profile, page updates, live dates, and artist drops.</Text>
      </View>
    </View>
  );
}

function ArtistPageReadNotice({ resource, onRetry }) {
  if (resource.status === "ready") return null;
  const hasConfirmedData = resource.updatedAt != null;
  const pending = resource.status === "loading" || resource.status === "refreshing";
  if (pending) {
    return (
      <View
        style={[styles.pageReadNotice, styles.pageReadPending]}
        accessibilityRole="progressbar"
        accessibilityLabel={hasConfirmedData ? "Refreshing artist page data" : "Loading artist page data"}
        accessibilityState={{ busy: true }}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator size="small" color={colors.amber} />
        <View style={styles.pageReadCopy}>
          <Text style={styles.pageReadTitle}>{hasConfirmedData ? "Refreshing verified page data" : "Loading your verified page data"}</Text>
          <Text style={styles.pageReadText}>
            {hasConfirmedData
              ? "Your last confirmed workspace stays visible while Pit checks for changes."
              : "Stats and readiness will appear after Pit confirms the artist profile and page updates."}
          </Text>
        </View>
      </View>
    );
  }
  if (resource.status !== "error") return null;
  return (
    <View style={[styles.pageReadNotice, styles.pageReadError]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.pageReadErrorIcon}><Icon name="x" size={15} color={colors.danger} strokeWidth={2.5} /></View>
      <View style={styles.pageReadCopy}>
        <Text style={styles.pageReadTitle}>{hasConfirmedData ? "Showing the last confirmed artist page" : "Artist page data is unavailable"}</Text>
        <Text selectable style={styles.pageReadText}>
          {resource.error?.userMessage || resource.error?.message || "Pit could not load this artist page."}
          {hasConfirmedData
            ? " Stats and readiness may be out of date until the refresh succeeds."
            : " Pit will not turn that failed read into zero stats or an empty updates list."}
        </Text>
        <Pressable
          style={({ pressed, focused }) => [styles.pageReadRetry, pressed && styles.pressed, focused && focusRing]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading artist page data"
          accessibilityHint="Checks the artist profile and page updates again"
        >
          <Text style={styles.pageReadRetryText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ArtistHubScreen({ onClose, onPreview, onEditPage, onEditAccount, onTourDates, onCampaignPost }) {
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const {
    session,
    artistSummary,
    artistProfile,
    artistPostsFor,
    loadArtistPage,
    addArtistPost,
    removeArtistPost,
    remoteArtistMeta,
    resolveArtist,
  } = useStore();
  const artistName = typeof session?.artistName === "string" ? session.artistName.trim() : "";
  const summary = artistSummary(artistName);
  const profile = artistProfile(artistName);
  const posts = artistPostsFor(artistName);
  const bundledCatalog = artistMeta(artistName);
  const catalog = bundledCatalog || remoteArtistMeta(artistName) || {};
  const model = useMemo(
    () => artistWorkspaceModel({ session, summary, profile, posts, catalog }),
    [session, summary, profile, posts, catalog],
  );
  const [draft, setDraft] = useState("");
  const [publishState, setPublishState] = useState({ status: "idle", message: "" });
  const inputRef = useRef(null);
  const artistPageScope = accountTargetScope(session?.id || null, `artist-page:${artistName.toLowerCase()}`);
  const [artistPageRequestVersion, setArtistPageRequestVersion] = useState(0);
  const [artistPageResource, setArtistPageResource] = useState(() => createLoadState({
    scope: artistPageScope,
    status: "loading",
    data: null,
  }));
  const scopedArtistPageResource = projectLoadState(artistPageResource, artistPageScope, null);
  const hasConfirmedArtistPage = artistPageEditReady(scopedArtistPageResource);
  const artistPostScope = accountTargetScope(session?.id || null, `artist-posts:${artistName.toLowerCase()}`);
  const publishRef = useRef({ sequence: 0, scope: artistPostScope, controller: null });
  const artistPostMutationRef = useRef({ sequence: 0, scope: artistPostScope, postId: null, controller: null });
  const [artistPostMutation, setArtistPostMutation] = useState({ scope: artistPostScope, postId: null, status: "idle", error: null });
  const [confirmPostId, setConfirmPostId] = useState(null);
  const scopedArtistPostMutation = artistPostMutation.scope === artistPostScope
    ? artistPostMutation
    : { scope: artistPostScope, postId: null, status: "idle", error: null };

  useEffect(() => {
    if (!artistName) return;
    const controller = new AbortController();
    let active = true;
    setArtistPageResource((current) => beginLoadState(current, {
      scope: artistPageScope,
      emptyData: null,
      retainData: true,
    }));
    void loadArtistPage(artistName, { signal: controller.signal }).then((result) => {
      if (!active || controller.signal.aborted) return;
      if (result?.ok) {
        setArtistPageResource(resolveLoadState({
          scope: artistPageScope,
          data: result.value,
          updatedAt: result.value.loadedAt,
        }));
        return;
      }
      setArtistPageResource((current) => rejectLoadState(current, {
        scope: artistPageScope,
        error: result.error,
        emptyData: null,
        retainData: true,
      }));
    });
    if (!bundledCatalog && !remoteArtistMeta(artistName)) resolveArtist(artistName);
    return () => {
      active = false;
      controller.abort();
    };
    // Store reads are intentionally keyed by the approved artist identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistName, artistPageScope, artistPageRequestVersion]);

  useEffect(() => {
    const activePublish = publishRef.current;
    activePublish.controller?.abort();
    publishRef.current = { sequence: activePublish.sequence + 1, scope: artistPostScope, controller: null };
    const active = artistPostMutationRef.current;
    active.controller?.abort();
    artistPostMutationRef.current = { sequence: active.sequence + 1, scope: artistPostScope, postId: null, controller: null };
    setArtistPostMutation({ scope: artistPostScope, postId: null, status: "idle", error: null });
    setConfirmPostId(null);
    setDraft("");
    setPublishState({ status: "idle", message: "" });
    return () => {
      publishRef.current.controller?.abort();
      artistPostMutationRef.current.controller?.abort();
    };
  }, [artistPostScope]);

  if (!model.authorized) return <Unauthorized onClose={onClose} />;

  const heroPhoto = profile.banner || summary.banner || catalog.photo || null;
  const avatarUser = {
    name: artistName,
    avatarUri: profile.avatarUri || summary.photo || catalog.photo || null,
    initials: artistName.slice(0, 2).toUpperCase(),
    avatarColor: colors.amber,
  };
  const stats = model.stats;
  const nextShow = model.nextShow;
  const scoreColor = model.stageReady ? colors.good : model.score >= 50 ? colors.gold : colors.amber;

  const openPageEditor = () => {
    if (!artistPageEditReady(scopedArtistPageResource)) return;
    onEditPage?.(artistName);
  };

  const runAction = (action) => {
    if (action === "edit") openPageEditor();
    else if (action === "tour") onTourDates?.();
    else if (action === "preview") onPreview?.(artistName);
    else if (action === "post") inputRef.current?.focus?.();
  };

  const publish = async () => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    if (!text || publishRef.current.controller) return;
    const controller = new AbortController();
    const operation = {
      sequence: publishRef.current.sequence + 1,
      scope: artistPostScope,
      controller,
    };
    publishRef.current = operation;
    setPublishState({ status: "pending", message: "" });
    try {
      const result = await addArtistPost(artistName, text, { signal: controller.signal });
      if (publishRef.current !== operation || operation.scope !== artistPostScope) return;
      if (result?.ok) {
        // A slow publish must not erase the next update the artist started
        // typing while the submitted text was in flight.
        setDraft((current) => current === submittedDraft ? "" : current);
        setPublishState({ status: "success", message: "Page update published to your artist profile." });
        return;
      }
      setPublishState({
        status: "error",
        message: result?.error?.userMessage || result?.error?.message || "That page update was not published. Your draft is still here.",
      });
    } catch (error) {
      if (!controller.signal.aborted && publishRef.current === operation
        && operation.scope === artistPostScope) {
        setPublishState({
          status: "error",
          message: error?.userMessage || error?.message || "That page update was not published. Your draft is still here.",
        });
      }
    } finally {
      if (publishRef.current === operation) publishRef.current = { ...operation, controller: null };
    }
  };

  const deletePageUpdate = async (postId) => {
    if (!postId || artistPostMutationRef.current.controller) return;
    const controller = new AbortController();
    const operation = {
      sequence: artistPostMutationRef.current.sequence + 1,
      scope: artistPostScope,
      postId,
      controller,
    };
    artistPostMutationRef.current = operation;
    setArtistPostMutation({ scope: artistPostScope, postId, status: "pending", error: null });
    try {
      const result = await removeArtistPost(artistName, postId, { signal: controller.signal });
      if (artistPostMutationRef.current !== operation || operation.scope !== artistPostScope) return;
      if (result?.ok) {
        setArtistPostMutation({ scope: artistPostScope, postId: null, status: "idle", error: null });
        setConfirmPostId(null);
      } else {
        setArtistPostMutation({ scope: artistPostScope, postId, status: "error", error: result?.error || null });
      }
    } catch (error) {
      if (!controller.signal.aborted && artistPostMutationRef.current === operation
        && operation.scope === artistPostScope) {
        setArtistPostMutation({ scope: artistPostScope, postId, status: "error", error });
      }
    } finally {
      if (artistPostMutationRef.current === operation) {
        artistPostMutationRef.current = { ...operation, controller: null };
      }
    }
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="ARTIST HQ" title={artistName} onBack={onClose} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          <View style={styles.hero}>
            {heroPhoto ? <SmartImage uri={heroPhoto} style={StyleSheet.absoluteFill} contain={false} accessible={false} /> : <View style={[StyleSheet.absoluteFill, styles.heroFallback]} />}
            <View style={styles.heroScrim} />
            <View style={styles.heroGlow} />
            <View style={styles.heroTopline}>
              <View style={styles.verifiedPill}>
                <Badge type="verified" size={15} tooltip={false} />
                <Text style={styles.verifiedText}>VERIFIED ARTIST WORKSPACE</Text>
              </View>
              <Pressable onPress={() => onPreview?.(artistName)} style={({ pressed, focused }) => [styles.previewPill, pressed && styles.pressed, focused && focusRing]} accessibilityRole="button" accessibilityLabel="Preview artist page as a fan">
                <Icon name="you" size={14} color={colors.text} />
                <Text style={styles.previewText}>Public artist profile</Text>
              </Pressable>
            </View>
            <View style={styles.heroBottom}>
              <View style={styles.heroIdentity}>
                <View style={styles.avatarRing}><Avatar user={avatarUser} size={82} /></View>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroKicker}>YOUR PUBLIC ERA, CONTROLLED HERE</Text>
                  <Text style={styles.heroName} numberOfLines={2}>{artistName}</Text>
                  <Text style={styles.heroSub}>Shape the page. Signal the next move. Turn live interest into a room full of people.</Text>
                </View>
              </View>
            </View>
          </View>

          <ArtistPageReadNotice
            resource={scopedArtistPageResource}
            onRetry={() => setArtistPageRequestVersion((version) => version + 1)}
          />

          {hasConfirmedArtistPage ? (
            <View style={styles.statsRow}>
              <MiniStat icon="calendar" value={stats.upcomingShows} label="upcoming" accent={colors.cool} />
              <MiniStat icon="comment" value={stats.updates} label="page updates" accent={colors.magenta} />
              <MiniStat icon="feed" value={stats.nights} label="logged nights" accent={colors.amber} />
              <MiniStat icon="star" value={stats.liveScore ? stats.liveScore.toFixed(1) : "—"} label="live score" accent={colors.gold} />
              <MiniStat icon="you" value={stats.ratings} label="rating signals" accent={colors.good} />
            </View>
          ) : null}

          <View style={styles.quickGrid}>
            <ActionTile
              icon="photo"
              title="Edit public page"
              detail={hasConfirmedArtistPage ? "Portrait, marquee, bio, and page-update visibility." : "Available after Pit confirms the current public page."}
              onPress={openPageEditor}
              disabled={!hasConfirmedArtistPage}
              accent={colors.magenta}
            />
            <ActionTile icon="star" title="Artist drop" detail="Publish one styled campaign post to the main feed." onPress={onCampaignPost} accent={colors.amber} />
            <ActionTile icon="calendar" title="Live dates" detail="Publish shows, official tickets, and scheduled dates." onPress={onTourDates} accent={colors.cool} />
            <ActionTile icon="you" title="Personal account" detail="Handle, city, genres, and favorite artists." onPress={onEditAccount} accent={colors.good} />
          </View>

          <View style={[styles.columns, !wide && styles.columnsStack]}>
            {hasConfirmedArtistPage ? <View style={[styles.panel, styles.readinessPanel]}>
              <SectionTitle eyebrow="PROMO READINESS" title="Make every visit count" detail="A practical check of what fans can act on right now." />
              <View style={styles.scoreRow}>
                <View style={[styles.scoreDisc, { borderColor: scoreColor }]}>
                  <Text style={[styles.score, { color: scoreColor }]}>{model.score}</Text>
                  <Text style={styles.scoreUnit}>%</Text>
                </View>
                <View style={styles.scoreCopy}>
                  <Text style={styles.scoreTitle}>{model.stageReady ? "Your page is stage ready" : "Build the full campaign surface"}</Text>
                  <Text style={styles.scoreDetail}>{model.completeCount} of {model.completion.length} essentials are live.</Text>
                  <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: model.score }}>
                    <View style={[styles.progressFill, { width: `${model.score}%`, backgroundColor: scoreColor }]} />
                  </View>
                </View>
              </View>
              {!!model.nextMove && (
                <Pressable onPress={() => runAction(model.nextMove.action)} style={({ pressed, focused }) => [styles.nextMove, pressed && styles.pressed, focused && focusRing]} accessibilityRole="button">
                  <View style={styles.nextMoveIcon}><Icon name="plus" size={17} color={colors.amber} strokeWidth={2.5} /></View>
                  <View style={styles.nextMoveCopy}>
                    <Text style={styles.nextMoveKicker}>BEST NEXT MOVE</Text>
                    <Text style={styles.nextMoveTitle}>{model.nextMove.label}</Text>
                  </View>
                  <Icon name="chevron-right" size={17} color={colors.amber} />
                </Pressable>
              )}
              <View style={styles.completionList}>
                {model.completion.map((item) => <CompletionRow key={item.key} item={item} onPress={() => runAction(item.action)} />)}
              </View>
            </View> : null}

            <View style={[styles.panel, styles.publishPanel]}>
              <SectionTitle eyebrow="PUBLIC ARTIST PROFILE" title="Page update" detail="Publish short news directly to the updates section of your artist profile." />
              {hasConfirmedArtistPage && !model.feedEnabled ? (
                <View style={styles.feedWarning}>
                  <Icon name="lock" size={16} color={colors.gold} />
                  <View style={styles.feedWarningCopy}>
                    <Text style={styles.feedWarningTitle}>Page updates are hidden</Text>
                    <Text style={styles.feedWarningText}>Use Edit public page to show these updates publicly. Artist drops still reach the main feed.</Text>
                  </View>
                </View>
              ) : null}
              <TextInput
                ref={inputRef}
                style={styles.composer}
                value={draft}
                onChangeText={(value) => {
                  setDraft(value);
                  if (publishState.status !== "pending") setPublishState({ status: "idle", message: "" });
                }}
                placeholder="Share a page update with fans…"
                placeholderTextColor={colors.textFaint}
                multiline
                maxLength={UPDATE_LIMIT}
                textAlignVertical="top"
                accessibilityLabel="Page update"
              />
              <View style={styles.composerFoot}>
                <Text style={styles.counter}>{draft.length}/{UPDATE_LIMIT}</Text>
                <Button title="Publish page update" icon="share" onPress={() => void publish()} loading={publishState.status === "pending"} disabled={!draft.trim()} small />
              </View>
              {!!publishState.message && (
                <View style={[styles.publishStatus, publishState.status === "error" ? styles.publishError : styles.publishSuccess]} accessibilityRole={publishState.status === "error" ? "alert" : "text"} accessibilityLiveRegion="polite">
                  <Icon name={publishState.status === "error" ? "x" : "check"} size={15} color={publishState.status === "error" ? colors.danger : colors.good} strokeWidth={2.5} />
                  <Text selectable style={[styles.publishStatusText, { color: publishState.status === "error" ? colors.danger : colors.good }]}>{publishState.message}</Text>
                </View>
              )}
              <View style={styles.recentHead}>
                <Text style={styles.recentLabel}>PAGE UPDATES</Text>
                {hasConfirmedArtistPage ? <Text style={styles.recentCount}>{posts.length} total</Text> : null}
              </View>
              {!hasConfirmedArtistPage ? (
                <View style={styles.emptyState} accessibilityLiveRegion="polite">
                  {scopedArtistPageResource.status === "loading"
                    ? <ActivityIndicator size="small" color={colors.textFaint} />
                    : <Icon name="lock" size={20} color={colors.textFaint} />}
                  <Text style={styles.emptyText}>
                    {scopedArtistPageResource.status === "error"
                      ? "Existing page updates are withheld because the artist page could not be confirmed."
                      : "Existing page updates will appear after the artist page is confirmed."}
                  </Text>
                </View>
              ) : posts.length ? posts.map((item) => (
                <View key={item.id} style={styles.updateRow}>
                  <View style={styles.updateRail} />
                  <View style={styles.updateCopy}>
                    <Text style={styles.updateText}>{item.text}</Text>
                    <Text style={styles.updateTime}>{item.ts || "now"}</Text>
                    {confirmPostId === item.id && scopedArtistPostMutation.status !== "error" ? (
                      <View style={styles.updateConfirm} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        <Text style={styles.updateConfirmText}>Remove this page update? It will disappear from the public artist profile.</Text>
                        <View style={styles.updateActions}>
                          <Pressable
                            style={({ pressed, focused }) => [styles.updateCancel, pressed && styles.pressed, focused && focusRing]}
                            onPress={() => setConfirmPostId(null)}
                            disabled={scopedArtistPostMutation.status === "pending"}
                            accessibilityRole="button"
                            accessibilityLabel="Keep page update"
                          >
                            <Text style={styles.updateCancelText}>Keep it</Text>
                          </Pressable>
                          <Pressable
                            style={({ pressed, focused }) => [styles.updateDeleteConfirm, pressed && styles.pressed, focused && focusRing]}
                            onPress={() => void deletePageUpdate(item.id)}
                            disabled={scopedArtistPostMutation.status === "pending"}
                            accessibilityRole="button"
                            accessibilityLabel="Remove page update permanently"
                            accessibilityState={{
                              disabled: scopedArtistPostMutation.status === "pending",
                              busy: scopedArtistPostMutation.status === "pending" && scopedArtistPostMutation.postId === item.id,
                            }}
                          >
                            {scopedArtistPostMutation.status === "pending" && scopedArtistPostMutation.postId === item.id
                              ? <ActivityIndicator size="small" color="#FFF8EE" />
                              : <Text style={styles.updateDeleteConfirmText}>Remove update</Text>}
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                    {scopedArtistPostMutation.status === "error" && scopedArtistPostMutation.postId === item.id ? (
                      <View style={styles.updateError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                        <Text selectable style={styles.updateErrorText}>
                          This page update was not removed, so it is still visible. {scopedArtistPostMutation.error?.userMessage || scopedArtistPostMutation.error?.message || "Try again."}
                        </Text>
                        <View style={styles.updateActions}>
                          {scopedArtistPostMutation.error?.retryable ? (
                            <Pressable style={({ pressed, focused }) => [styles.updateRetry, pressed && styles.pressed, focused && focusRing]} onPress={() => void deletePageUpdate(item.id)} accessibilityRole="button" accessibilityLabel="Retry removing page update">
                              <Text style={styles.updateRetryText}>Try again</Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            style={({ pressed, focused }) => [styles.updateCancel, pressed && styles.pressed, focused && focusRing]}
                            onPress={() => {
                              setArtistPostMutation({ scope: artistPostScope, postId: null, status: "idle", error: null });
                              setConfirmPostId(null);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Dismiss page update error"
                          >
                            <Text style={styles.updateCancelText}>Dismiss</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    style={({ pressed, focused }) => [styles.updateRemove, pressed && styles.pressed, focused && focusRing]}
                    onPress={() => {
                      setArtistPostMutation({ scope: artistPostScope, postId: null, status: "idle", error: null });
                      setConfirmPostId((current) => current === item.id ? null : item.id);
                    }}
                    disabled={scopedArtistPostMutation.status === "pending"}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove page update: ${item.text}`}
                    accessibilityState={{ disabled: scopedArtistPostMutation.status === "pending", expanded: confirmPostId === item.id }}
                  >
                    <Icon name="x" size={15} color={colors.textFaint} />
                  </Pressable>
                </View>
              )) : (
                <View style={styles.emptyState}>
                  <Icon name="comment" size={20} color={colors.textFaint} />
                  <Text style={styles.emptyText}>Your first page update will appear here.</Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.columns, !wide && styles.columnsStack]}>
            <View style={[styles.panel, styles.livePanel]}>
              <SectionTitle eyebrow="LIVE DESK" title={nextShow ? "The next room" : "Put the next room on the map"} detail="Keep the public path from discovery to the door clean." right={<View style={styles.liveIcon}><Icon name="ticket" size={19} color={colors.cool} /></View>} />
              {nextShow ? (
                <View style={styles.showCard}>
                  <View style={styles.dateBlock}>
                    <Text style={styles.dateMonth}>{String(formatDate(nextShow.date, nextShow.date)).split(" · ")[1] || "LIVE"}</Text>
                    <Text style={styles.dateDay}>{String(formatDate(nextShow.date, nextShow.date)).split(" · ")[2] || "—"}</Text>
                  </View>
                  <View style={styles.showCopy}>
                    <View style={styles.showTopline}>
                      <Text style={styles.showVenue} numberOfLines={1}>{nextShow.venue || "Venue TBA"}</Text>
                      {nextShow.scheduled && <Text style={styles.scheduledPill}>SCHEDULED</Text>}
                    </View>
                    <Text style={styles.showPlace} numberOfLines={2}>{nextShow.place || "Location TBA"}</Text>
                    <Text style={styles.showDate}>{formatDate(nextShow.date, nextShow.date)}</Text>
                    <View style={styles.ticketState}>
                      <Icon name={/^https:\/\//i.test(nextShow.ticketUrl || "") ? "check" : "x"} size={13} color={/^https:\/\//i.test(nextShow.ticketUrl || "") ? colors.good : colors.gold} />
                      <Text style={[styles.ticketStateText, { color: /^https:\/\//i.test(nextShow.ticketUrl || "") ? colors.good : colors.gold }]}>{/^https:\/\//i.test(nextShow.ticketUrl || "") ? "Official ticket path attached" : "Ticket path still needed"}</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.liveEmpty}>
                  <View style={styles.liveEmptyIcon}><Icon name="calendar" size={24} color={colors.cool} /></View>
                  <Text style={styles.liveEmptyTitle}>No upcoming performance yet</Text>
                  <Text style={styles.liveEmptyText}>Add the next date with an official ticket link so fans have somewhere to go.</Text>
                </View>
              )}
            </View>

          </View>

          <View style={styles.truthNote}>
            <Icon name="shield" size={16} color={colors.textFaint} />
            <Text style={styles.truthText}>HQ only shows signals Pit can verify: published dates, page updates, logged nights, and real ratings. No invented reach numbers.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(20) },
  container: { width: "100%", maxWidth: 1120, alignSelf: "center", gap: space(5) },
  denied: { width: "100%", maxWidth: 460, alignSelf: "center", alignItems: "center", padding: space(8), marginTop: space(12), backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, ...shadow.card },
  deniedIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: colors.amber + "18", marginBottom: space(4) },
  deniedTitle: { color: colors.text, fontFamily: displayFont, fontWeight: "900", fontSize: 21, textAlign: "center" },
  deniedCopy: { color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: space(2) },
  pageReadNotice: { flexDirection: "row", alignItems: "flex-start", gap: space(3), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, padding: space(4) },
  pageReadPending: { backgroundColor: colors.amber + "0D", borderColor: colors.amber + "42" },
  pageReadError: { backgroundColor: colors.danger + "0D", borderColor: colors.danger + "52" },
  pageReadErrorIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger + "16" },
  pageReadCopy: { flex: 1, minWidth: 0 },
  pageReadTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  pageReadText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  pageReadRetry: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, paddingHorizontal: space(4), marginTop: space(3) },
  pageReadRetryText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  hero: { minHeight: 390, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, padding: space(5), justifyContent: "space-between", ...shadow.card },
  heroFallback: { backgroundColor: colors.surfaceAlt },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,5,9,0.58)" },
  heroGlow: { position: "absolute", left: -90, bottom: -130, width: 440, height: 330, borderRadius: 240, backgroundColor: colors.amberStrong + "2E" },
  heroTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3) },
  verifiedPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(6,8,13,0.74)", borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  verifiedText: { color: "#F4EFE7", fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.25 },
  previewPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(6,8,13,0.74)", borderRadius: radius.pill, minHeight: 38, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  previewText: { color: "#F4EFE7", fontSize: 12, fontWeight: "800" },
  heroBottom: { gap: space(5) },
  heroIdentity: { flexDirection: "row", alignItems: "flex-end", gap: space(4) },
  avatarRing: { width: 90, height: 90, borderRadius: 45, borderWidth: 4, borderColor: "rgba(244,239,231,0.88)", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", ...shadow.control },
  heroCopy: { flex: 1, minWidth: 0 },
  heroKicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.45, marginBottom: space(1) },
  heroName: { color: "#FFF8EE", fontFamily: displayFont, fontSize: 38, lineHeight: 42, letterSpacing: -1.35, fontWeight: "900" },
  heroSub: { color: "rgba(255,248,238,0.76)", fontSize: 14, lineHeight: 20, marginTop: space(1), maxWidth: 650 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  statCard: { flexGrow: 1, flexBasis: 150, minWidth: 130, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: space(4), ...shadow.card },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: space(3) },
  statValue: { color: colors.text, fontFamily: displayFont, fontSize: 25, fontWeight: "900", letterSpacing: -0.6 },
  statLabel: { color: colors.textDim, fontSize: 11, fontFamily: mono, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  actionTile: { flex: 1, flexBasis: 250, minWidth: 220, flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 94, padding: space(4), backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderBottomWidth: 3, borderColor: colors.line, ...shadow.control },
  actionTileDisabled: { opacity: 0.55 },
  actionIcon: { width: 44, height: 44, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  actionDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.82, transform: [{ translateY: 1 }] },
  columns: { flexDirection: "row", alignItems: "stretch", gap: space(4) },
  columnsStack: { flexDirection: "column" },
  panel: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: space(5), ...shadow.card },
  readinessPanel: { flex: 1.03 },
  publishPanel: { flex: 0.97 },
  livePanel: { minHeight: 350 },
  sectionHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space(3), marginBottom: space(5) },
  sectionCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5, marginBottom: space(1) },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.55 },
  sectionDetail: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: space(1), maxWidth: 520 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: space(4), paddingBottom: space(5), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  scoreDisc: { width: 88, height: 88, borderRadius: 44, borderWidth: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  score: { fontFamily: displayFont, fontSize: 28, lineHeight: 30, fontWeight: "900", letterSpacing: -1 },
  scoreUnit: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800" },
  scoreCopy: { flex: 1, minWidth: 0 },
  scoreTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  scoreDetail: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  progressTrack: { height: 7, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.surfaceAlt, marginTop: space(3) },
  progressFill: { height: "100%", borderRadius: radius.pill },
  nextMove: { flexDirection: "row", alignItems: "center", gap: space(3), marginTop: space(4), padding: space(3), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.amberStrong + "12", borderWidth: 1, borderColor: colors.amber + "52" },
  nextMoveIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.amber + "1A", alignItems: "center", justifyContent: "center" },
  nextMoveCopy: { flex: 1 },
  nextMoveKicker: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  nextMoveTitle: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 2 },
  completionList: { marginTop: space(3) },
  completionRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  completionPressed: { backgroundColor: colors.surfaceAlt, marginHorizontal: -space(2), paddingHorizontal: space(2), borderRadius: radius.sm },
  completionMark: { width: 25, height: 25, borderRadius: 13, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  completionMarkDone: { backgroundColor: colors.good, borderColor: colors.good },
  completionCopy: { flex: 1, minWidth: 0 },
  completionTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  completionTitleDone: { color: colors.textDim },
  completionDetail: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 2 },
  feedWarning: { flexDirection: "row", alignItems: "center", gap: space(3), backgroundColor: colors.gold + "10", borderWidth: 1, borderColor: colors.gold + "45", borderRadius: radius.md, borderCurve: "continuous", padding: space(3), marginBottom: space(3) },
  feedWarningCopy: { flex: 1 },
  feedWarningTitle: { color: colors.gold, fontSize: 12, fontWeight: "900" },
  feedWarningText: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 2 },
  composer: { minHeight: 144, maxHeight: 240, color: colors.text, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, paddingHorizontal: space(4), paddingVertical: space(4), fontSize: 15, lineHeight: 22 },
  composerFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), marginTop: space(3) },
  counter: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  publishStatus: { flexDirection: "row", alignItems: "flex-start", gap: space(2), padding: space(3), marginTop: space(3), borderRadius: radius.sm, borderWidth: 1 },
  publishSuccess: { backgroundColor: colors.good + "10", borderColor: colors.good + "45" },
  publishError: { backgroundColor: colors.danger + "10", borderColor: colors.danger + "45" },
  publishStatusText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  recentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(6), marginBottom: space(2) },
  recentLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  recentCount: { color: colors.textDim, fontSize: 11 },
  updateRow: { flexDirection: "row", gap: space(3), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  updateRail: { width: 3, borderRadius: radius.pill, backgroundColor: colors.magenta },
  updateCopy: { flex: 1, minWidth: 0 },
  updateText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  updateTime: { color: colors.textFaint, fontFamily: mono, fontSize: 9, marginTop: space(1) },
  updateRemove: { width: 44, height: 44, marginTop: -space(2), marginRight: -space(2), borderRadius: 22, alignItems: "center", justifyContent: "center" },
  updateConfirm: { gap: space(2), marginTop: space(3), padding: space(3), borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.danger + "0D", borderWidth: 1, borderColor: colors.danger + "42" },
  updateConfirmText: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  updateError: { gap: space(2), marginTop: space(3), padding: space(3), borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.danger + "0D", borderWidth: 1, borderColor: colors.danger + "55" },
  updateErrorText: { color: colors.danger, fontSize: 11.5, lineHeight: 17 },
  updateActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: space(2) },
  updateCancel: { minHeight: 44, justifyContent: "center", paddingHorizontal: space(3), borderRadius: radius.pill },
  updateCancelText: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  updateDeleteConfirm: { minWidth: 128, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space(3), borderRadius: radius.pill, backgroundColor: colors.danger },
  updateDeleteConfirmText: { color: "#FFF8EE", fontSize: 12, fontWeight: "900" },
  updateRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  updateRetryText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  emptyState: { alignItems: "center", justifyContent: "center", minHeight: 100, gap: space(2), backgroundColor: colors.bgElev, borderRadius: radius.md, padding: space(4) },
  emptyText: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  liveIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.cool + "16", alignItems: "center", justifyContent: "center" },
  showCard: { flexDirection: "row", alignItems: "stretch", gap: space(4), padding: space(4), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, minHeight: 155 },
  dateBlock: { width: 72, borderRadius: radius.md, backgroundColor: colors.cool + "18", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.cool + "40" },
  dateMonth: { color: colors.cool, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  dateDay: { color: colors.text, fontFamily: displayFont, fontSize: 31, fontWeight: "900", lineHeight: 34 },
  showCopy: { flex: 1, justifyContent: "center", minWidth: 0 },
  showTopline: { flexDirection: "row", alignItems: "center", gap: space(2) },
  showVenue: { flex: 1, color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900" },
  scheduledPill: { color: colors.gold, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, backgroundColor: colors.gold + "12", borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 4 },
  showPlace: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: space(1) },
  showDate: { color: colors.textFaint, fontFamily: mono, fontSize: 10, marginTop: space(2) },
  ticketState: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: space(3) },
  ticketStateText: { fontSize: 11, fontWeight: "800" },
  liveEmpty: { alignItems: "center", justifyContent: "center", minHeight: 170, padding: space(4), borderRadius: radius.md, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  liveEmptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.cool + "16", marginBottom: space(3) },
  liveEmptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "900", textAlign: "center" },
  liveEmptyText: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 330, marginTop: space(1) },
  truthNote: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: space(2), maxWidth: 720, paddingHorizontal: space(4) },
  truthText: { flex: 1, color: colors.textFaint, fontSize: 11, lineHeight: 16, textAlign: "center" },
});
