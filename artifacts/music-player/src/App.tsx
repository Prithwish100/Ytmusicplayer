import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Link,
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Disc3, Search, Heart, Plus, Play, Pause, SkipBack, SkipForward, Shuffle,
  Repeat, Repeat1, Volume2, VolumeX, X, Music2, RotateCw,
} from 'lucide-react';
import {
  getListMyFavoritesQueryKey,
  getSearchMusicQueryKey,
  useDeleteMyFavorite,
  useListMyFavorites,
  useSearchMusic,
  useUpsertMyFavorite,
} from '@workspace/api-client-react';
import type { MusicTrack } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the project environment.');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#4d9c86',
    colorForeground: '#eeeae1',
    colorMutedForeground: '#a0aaa0',
    colorDanger: '#f0b09d',
    colorBackground: '#1b211e',
    colorInput: '#131816',
    colorInputForeground: '#eeeae1',
    colorNeutral: '#3c4841',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '1rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#1b211e] border border-[#3c4841] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#eeeae1] font-extrabold',
    headerSubtitle: 'text-[#a0aaa0]',
    socialButtonsBlockButtonText: 'text-[#eeeae1]',
    formFieldLabel: 'text-[#e7e3da]',
    footerActionLink: 'text-[#8bc8b3]',
    footerActionText: 'text-[#a0aaa0]',
    dividerText: 'text-[#a0aaa0]',
    identityPreviewEditButton: 'text-[#8bc8b3]',
    formFieldSuccessText: 'text-[#8bc8b3]',
    alertText: 'text-[#f0b09d]',
    logoBox: 'mb-3',
    logoImage: 'h-8 w-8',
    socialButtonsBlockButton: 'bg-[#252d29] border border-[#3c4841] hover:bg-[#2f3b35]',
    formButtonPrimary: 'bg-[#397f70] text-white hover:bg-[#478f7e]',
    formFieldInput: 'bg-[#131816] text-[#eeeae1] border-[#3c4841]',
    footerAction: 'border-t border-[#3c4841]',
    dividerLine: 'bg-[#3c4841]',
    alert: 'bg-[#382a27] border-[#684239]',
    otpCodeFieldInput: 'bg-[#131816] text-[#eeeae1] border-[#3c4841]',
    formFieldRow: 'text-[#e7e3da]',
    main: 'text-[#eeeae1]',
  },
};

type RepeatMode = 'off' | 'all' | 'one';
type PlayerSettings = { volume: number; shuffle: boolean; repeat: RepeatMode };

const STORAGE = {
  queue: 'afterhours.queue',
  favorites: 'afterhours.favorites',
  settings: 'afterhours.settings',
};

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function mergeTracks(...groups: MusicTrack[][]): MusicTrack[] {
  const seen = new Set<string>();
  return groups.flat().filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function favoriteInput(track: MusicTrack) {
  return {
    title: track.title,
    artist: track.artist,
    durationSeconds: track.durationSeconds,
    thumbnailUrl: track.thumbnailUrl,
  };
}

function formatTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—:—';
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function Cover({ track, className = '' }: { track?: MusicTrack | null; className?: string }) {
  if (track?.thumbnailUrl) {
    return <img className={`track-art ${className}`} src={track.thumbnailUrl} alt="" />;
  }
  return <div className={`track-art track-art-fallback ${className}`}><Music2 size={18} /></div>;
}

function Home() {
  const { user, isLoaded: authLoaded, isSignedIn } = useUser();
  const userId = isSignedIn ? user?.id : null;
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [queue, setQueue] = useState<MusicTrack[]>(() => readStored(STORAGE.queue, []));
  const [favorites, setFavorites] = useState<MusicTrack[]>(() => readStored(STORAGE.favorites, []));
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [settings, setSettings] = useState<PlayerSettings>(() =>
    readStored(STORAGE.settings, { volume: 0.72, shuffle: false, repeat: 'off' }),
  );
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const initialQueue = readStored<MusicTrack[]>(STORAGE.queue, []);
    return initialQueue[0]?.id ?? null;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [notice, setNotice] = useState('');
  const [activeView, setActiveView] = useState<'search' | 'favorites'>('search');
  const audioRef = useRef<HTMLAudioElement>(null);
  const favoriteMergeUserRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const favoritesQuery = useListMyFavorites({
    query: {
      enabled: Boolean(authLoaded && userId),
      queryKey: getListMyFavoritesQueryKey(),
    },
  });
  const saveFavorite = useUpsertMyFavorite();
  const removeFavorite = useDeleteMyFavorite();
  const searchQuery = submittedQuery.trim();
  const search = useSearchMusic(
    { q: searchQuery || ' ' },
    { query: { enabled: Boolean(searchQuery), queryKey: getSearchMusicQueryKey({ q: searchQuery || ' ' }) } },
  );
  const results = (search.data ?? []) as MusicTrack[];
  const currentTrack = queue.find((track) => track.id === currentId) ?? null;

  useEffect(() => { localStorage.setItem(STORAGE.queue, JSON.stringify(queue)); }, [queue]);
  const favoriteStorageKey = userId ? `${STORAGE.favorites}.${userId}` : STORAGE.favorites;
  useEffect(() => {
    if (!authLoaded) return;
    setFavoritesReady(false);
    favoriteMergeUserRef.current = null;
    if (userId) {
      setFavorites(readStored(`${STORAGE.favorites}.${userId}`, []));
    } else {
      setFavorites(readStored(STORAGE.favorites, []));
      setFavoritesReady(true);
    }
  }, [authLoaded, userId]);
  useEffect(() => {
    if (!authLoaded || (userId && !favoritesReady)) return;
    localStorage.setItem(favoriteStorageKey, JSON.stringify(favorites));
  }, [authLoaded, favoriteStorageKey, favorites, favoritesReady, userId]);
  useEffect(() => {
    if (!authLoaded || !userId || (!favoritesQuery.isSuccess && !favoritesQuery.isError)) return;
    if (favoriteMergeUserRef.current === userId) return;
    favoriteMergeUserRef.current = userId;

    const accountFavorites = readStored<MusicTrack[]>(`${STORAGE.favorites}.${userId}`, []);
    const guestFavorites = readStored<MusicTrack[]>(STORAGE.favorites, []);
    const cloudFavorites = favoritesQuery.isSuccess ? (favoritesQuery.data ?? []) : [];
    const localFavorites = mergeTracks(accountFavorites, guestFavorites);
    const merged = mergeTracks(localFavorites, cloudFavorites);
    const cloudIds = new Set(cloudFavorites.map((track) => track.id));
    const toSync = localFavorites.filter((track) => !cloudIds.has(track.id));
    setFavorites(merged);

    const finishMerge = async () => {
      try {
        await Promise.all(
          toSync.map((track) =>
            saveFavorite.mutateAsync({ id: track.id, data: favoriteInput(track) }),
          ),
        );
        if (guestFavorites.length) localStorage.removeItem(STORAGE.favorites);
        queryClient.setQueryData(favoritesQuery.queryKey, merged);
      } catch {
        setNotice('Some Loved songs could not sync yet. They are still saved on this device.');
      } finally {
        setFavoritesReady(true);
      }
    };

    void finishMerge();
  }, [
    authLoaded,
    favoritesQuery.data,
    favoritesQuery.isError,
    favoritesQuery.isSuccess,
    favoritesQuery.queryKey,
    queryClient,
    saveFavorite.mutateAsync,
    userId,
  ]);
  useEffect(() => { localStorage.setItem(STORAGE.settings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = settings.volume;
  }, [settings.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute('src');
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    audio.src = currentTrack.playbackUrl;
    audio.load();
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds ?? 0);
    if (isPlaying) {
      void audio.play().catch(() => {
        setIsPlaying(false);
        setNotice('This track could not be played. Try another result.');
      });
    }
  }, [currentTrack?.id, currentTrack?.playbackUrl]);

  const startTrack = useCallback((track: MusicTrack) => {
    const alreadyCurrent = currentId === track.id;
    setQueue((existing) => {
      const index = existing.findIndex((item) => item.id === track.id);
      if (index >= 0) {
        const rearranged = [...existing];
        const [selected] = rearranged.splice(index, 1);
        rearranged.unshift(selected);
        return rearranged;
      }
      return [track, ...existing];
    });
    setCurrentId(track.id);
    setCurrentTime(0);
    setIsPlaying(true);
    setNotice('');
    if (alreadyCurrent && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        setIsPlaying(false);
        setNotice('This track could not be played. Try another result.');
      });
    }
  }, [currentId]);

  const addToQueue = useCallback((track: MusicTrack) => {
    setQueue((existing) => {
      if (existing.some((item) => item.id === track.id)) return existing;
      return [...existing, track];
    });
    setNotice(`${track.title} added to your queue`);
    window.setTimeout(() => setNotice(''), 2400);
  }, []);

  const toggleFavorite = useCallback((track: MusicTrack) => {
    if (userId && !favoritesReady) {
      setNotice('Your Loved list is still syncing. Try again in a moment.');
      return;
    }
    const alreadyLoved = favorites.some((item) => item.id === track.id);
    const next = alreadyLoved
      ? favorites.filter((item) => item.id !== track.id)
      : [track, ...favorites];
    setFavorites(next);
    localStorage.setItem(favoriteStorageKey, JSON.stringify(next));

    if (!userId) return;
    queryClient.setQueryData(favoritesQuery.queryKey, next);
    if (alreadyLoved) {
      removeFavorite.mutate(
        { id: track.id },
        { onError: () => setNotice('Could not remove that song from your account. It is still saved on this device.') },
      );
    } else {
      saveFavorite.mutate(
        { id: track.id, data: favoriteInput(track) },
        { onError: () => setNotice('Could not sync that song yet. It is still saved on this device.') },
      );
    }
  }, [
    favoriteStorageKey,
    favorites,
    favoritesQuery.queryKey,
    favoritesReady,
    queryClient,
    removeFavorite,
    saveFavorite,
    userId,
  ]);

  const stepTrack = useCallback((direction: -1 | 1) => {
    if (!queue.length) return;
    const index = queue.findIndex((track) => track.id === currentId);
    if (settings.shuffle && direction === 1 && queue.length > 1) {
      const options = queue.filter((track) => track.id !== currentId);
      const next = options[Math.floor(Math.random() * options.length)];
      setCurrentId(next.id);
      setIsPlaying(true);
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex >= 0 && nextIndex < queue.length) {
      setCurrentId(queue[nextIndex].id);
      setIsPlaying(true);
    } else if (settings.repeat === 'all') {
      const nextTrack = queue[direction > 0 ? 0 : queue.length - 1];
      if (nextTrack.id === currentId && audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play();
      }
      setCurrentId(nextTrack.id);
      setIsPlaying(true);
    } else if (direction < 0) {
      const audio = audioRef.current;
      if (audio && audio.currentTime > 3) audio.currentTime = 0;
      else if (queue[index - 1]) setCurrentId(queue[index - 1].id);
    } else {
      setIsPlaying(false);
    }
  }, [currentId, queue, settings.shuffle, settings.repeat]);

  const togglePlayback = () => {
    if (!currentTrack) {
      if (queue[0]) startTrack(queue[0]);
      return;
    }
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      setNotice('');
      void audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(false);
        setNotice('This track could not be played. Try another result.');
      });
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim().slice(0, 160);
    if (query) {
      setActiveView('search');
      setSubmittedQuery(query);
    }
  };

  const removeFromQueue = (trackId: string) => {
    const removedCurrent = trackId === currentId;
    const remaining = queue.filter((track) => track.id !== trackId);
    setQueue(remaining);
    if (removedCurrent) {
      setCurrentId(remaining[0]?.id ?? null);
      setIsPlaying(Boolean(remaining[0]));
    }
  };

  const toggleRepeat = () => setSettings((value) => ({
    ...value,
    repeat: value.repeat === 'off' ? 'all' : value.repeat === 'all' ? 'one' : 'off',
  }));
  const isFavorite = (track: MusicTrack) => favorites.some((item) => item.id === track.id);

  const visibleTracks = useMemo(() => activeView === 'favorites' ? favorites : results, [activeView, favorites, results]);

  return (
    <main className="desk-shell">
      <header className="topbar">
        <div className="brand" aria-label="Afterhours">
          <div className="brand-mark"><Disc3 size={20} strokeWidth={1.8} /></div>
          <div className="brand-name">Afterhours<span> / listening desk</span></div>
        </div>
        <div className="header-actions">
          <AccountControls />
          <div className="top-meta"><span className="live-dot" /> A little room for music</div>
        </div>
      </header>

      <div className="workspace">
        <section className="main-column">
          <div className="intro">
            <div>
              <div className="creator-credit">Made by Prithwish</div>
              <div className="eyebrow">Your own frequency</div>
              <h1>Find your<br /><em>afterhours.</em></h1>
            </div>
            <div className="date-chip">Search · collect · listen</div>
          </div>

          <form className="search-wrap" onSubmit={submitSearch}>
            <Search className="search-icon" size={19} />
            <input
              className="search-input"
              type="search"
              aria-label="Search songs"
              data-testid="input-search-music"
              placeholder="Search a song, artist, or feeling..."
              maxLength={160}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <button className="search-submit" type="submit" data-testid="button-search">Search</button>
          </form>

          <div className="content-head">
            <div>
              <h2 className="section-title">{activeView === 'favorites' ? 'Loved songs' : searchQuery ? `Results for “${searchQuery}”` : 'The listening desk'}</h2>
              <div className="section-caption">{activeView === 'favorites' ? userId ? favoritesReady ? 'Saved to your account' : 'Syncing your account' : 'Sign in to keep across visits' : searchQuery ? 'YouTube Music search' : 'A good song is a good place to start'}</div>
            </div>
            <div className="result-count">{activeView === 'favorites' ? `${favorites.length} saved` : searchQuery ? `${results.length} tracks` : ''}</div>
          </div>

          {activeView === 'favorites' ? (
            favorites.length ? (
              <div className="track-list">
                {favorites.map((track, index) => (
                  <TrackRow key={track.id} track={track} index={index} favorite={true} playing={currentId === track.id && isPlaying}
                    onPlay={() => startTrack(track)} onQueue={() => addToQueue(track)} onFavorite={() => toggleFavorite(track)} />
                ))}
              </div>
            ) : <EmptyState title="No Loved songs yet" text={userId ? 'Tap the heart beside a song to save it to your account.' : 'Tap a heart to save a song here, then sign in to keep it across visits.'} />
          ) : search.isLoading ? (
            <div className="loading-list" aria-label="Searching">
              <div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" />
            </div>
          ) : search.isError ? (
            <div className="error-state" role="alert">
              <span>Search lost its signal. Check your connection and try again.</span>
              <button className="retry-button" type="button" onClick={() => void search.refetch()}><RotateCw size={13} /> Retry</button>
            </div>
          ) : searchQuery && !results.length ? (
            <EmptyState title="No songs found this time" text="Try a shorter title, a different spelling, or search by artist." />
          ) : results.length ? (
            <div className="track-list">
              {results.map((track, index) => (
                <TrackRow key={track.id} track={track} index={index} favorite={isFavorite(track)} playing={currentId === track.id && isPlaying}
                  onPlay={() => startTrack(track)} onQueue={() => addToQueue(track)} onFavorite={() => toggleFavorite(track)} />
              ))}
            </div>
          ) : (
            <EmptyState title="A quiet desk, waiting" text="Search for something you love. Your results, queue, and player all live here." />
          )}

          <div className="favorites-panel">
            <div className="favorites-head">
              <div className="favorites-heading"><Heart size={15} className="heart-tint" /> Loved songs</div>
              <button className="icon-button" aria-label="Show favorites" data-testid="button-show-favorites" onClick={() => setActiveView(activeView === 'favorites' ? 'search' : 'favorites')}>
                <span className="section-caption">{activeView === 'favorites' ? 'Back to search' : 'See all'}</span>
              </button>
            </div>
            {favorites.length === 0 ? (
              <div className="favorite-empty">
                Songs you save with a heart will find a home here.
                {!userId && <> <Link className="inline-sign-in" href="/sign-in">Sign in to keep them across visits.</Link></>}
              </div>
            ) : favorites.slice(0, 3).map((track) => (
              <div className="favorite-line" key={track.id} onClick={() => startTrack(track)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') startTrack(track); }} data-testid={`favorite-track-${track.id}`}>
                <div><div className="favorite-title">{track.title}</div><div className="favorite-artist">{track.artist}</div></div>
                <Play size={14} />
              </div>
            ))}
          </div>
        </section>

        <aside className="side-column">
          <section className="queue-panel">
            <div className="queue-top">
              <div className="queue-heading">Up next</div>
              <div className="queue-total">{queue.length} {queue.length === 1 ? 'TRACK' : 'TRACKS'}</div>
            </div>
            <div className="queue-sub">Your small, ever-changing setlist.</div>
            <div className="queue-list">
              {queue.length ? queue.map((track) => (
                <div className={`queue-item ${track.id === currentId ? 'current' : ''}`} key={track.id}>
                  <Cover track={track} className="queue-thumb" />
                  <div className="queue-copy" onClick={() => startTrack(track)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') startTrack(track); }}>
                    <div className="queue-name">{track.title}</div>
                    <div className="queue-artist">{track.artist}{track.id === currentId ? ' · now playing' : ''}</div>
                  </div>
                  <button className="icon-button" aria-label={`Remove ${track.title} from queue`} data-testid={`button-remove-queue-${track.id}`} onClick={() => removeFromQueue(track.id)}><X size={14} /></button>
                </div>
              )) : <div className="queue-empty">A few songs, in just the right order.<br />Add tracks from your search.</div>}
            </div>
            {queue.length > 0 && <button className="queue-clear" type="button" data-testid="button-clear-queue" onClick={() => { setQueue([]); setCurrentId(null); setIsPlaying(false); }}>Clear queue</button>}
          </section>
        </aside>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || currentTrack?.durationSeconds || 0)}
        onEnded={() => {
          if (settings.repeat === 'one') {
            const audio = audioRef.current;
            if (audio) { audio.currentTime = 0; void audio.play(); }
          } else stepTrack(1);
        }}
        onError={() => {
          if (currentTrack && isPlaying) {
            setIsPlaying(false);
            setNotice('Audio is unavailable for this result. Choose another track to keep listening.');
          }
        }}
        preload="metadata"
      />

      <footer className="player-dock">
        <div className="player-inner">
          <div className="now-playing">
            <Cover track={currentTrack} className="now-art" />
            <div className="now-copy">
              <div className="now-label">Now playing</div>
              <div className="now-title">{currentTrack?.title ?? 'Nothing playing yet'}</div>
              <div className="now-artist">{currentTrack?.artist ?? 'Choose a track to begin'}</div>
            </div>
            {currentTrack && <button className={`icon-button ${isFavorite(currentTrack) ? 'active' : ''}`} aria-label={isFavorite(currentTrack) ? 'Remove from favorites' : 'Add to favorites'} data-testid="button-player-favorite" onClick={() => toggleFavorite(currentTrack)}><Heart size={17} fill={isFavorite(currentTrack) ? 'currentColor' : 'none'} /></button>}
          </div>
          <div className="player-controls">
            <div className="control-row">
              <button className={`transport ${settings.shuffle ? 'on' : ''}`} aria-label="Toggle shuffle" aria-pressed={settings.shuffle} data-testid="button-shuffle" onClick={() => setSettings((value) => ({ ...value, shuffle: !value.shuffle }))}><Shuffle size={16} /></button>
              <button className="transport" aria-label="Previous track" data-testid="button-previous" onClick={() => stepTrack(-1)}><SkipBack size={18} fill="currentColor" /></button>
              <button className="play-button" aria-label={isPlaying ? 'Pause' : 'Play'} data-testid="button-play-pause" onClick={togglePlayback}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
              <button className="transport" aria-label="Next track" data-testid="button-next" onClick={() => stepTrack(1)}><SkipForward size={18} fill="currentColor" /></button>
              <button className={`transport ${settings.repeat !== 'off' ? 'on' : ''}`} aria-label={`Repeat ${settings.repeat}`} aria-pressed={settings.repeat !== 'off'} data-testid="button-repeat" onClick={toggleRepeat}>{settings.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
            </div>
            <div className="timeline">
              <span className="time-label">{formatTime(currentTime)}</span>
              <input className="seek-range" aria-label="Seek track" data-testid="input-seek" type="range" min={0} max={duration || 100} step={1} value={Math.min(currentTime, duration || 100)} style={{ ['--progress' as string]: `${duration ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCurrentTime(value);
                  if (audioRef.current) audioRef.current.currentTime = value;
                }} />
              <span className="time-label">{formatTime(duration || currentTrack?.durationSeconds)}</span>
            </div>
          </div>
          <div className="volume-control">
            <button className="transport" aria-label={settings.volume === 0 ? 'Unmute' : 'Mute'} data-testid="button-mute" onClick={() => setSettings((value) => ({ ...value, volume: value.volume === 0 ? 0.72 : 0 }))}>
              {settings.volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input className="volume-range" aria-label="Volume" data-testid="input-volume" type="range" min={0} max={1} step={0.01} value={settings.volume} style={{ ['--volume' as string]: `${settings.volume * 100}%` } as CSSProperties}
              onChange={(event) => setSettings((value) => ({ ...value, volume: Number(event.target.value) }))} />
          </div>
        </div>
        {notice && <div className="player-notice" role="status">{notice}</div>}
      </footer>
    </main>
  );
}

function TrackRow({ track, index, favorite, playing, onPlay, onQueue, onFavorite }: {
  track: MusicTrack; index: number; favorite: boolean; playing: boolean;
  onPlay: () => void; onQueue: () => void; onFavorite: () => void;
}) {
  return (
    <div className="track-row" data-testid={`row-track-${track.id}`}>
      <div className="track-index">{playing ? <Music2 size={14} /> : String(index + 1).padStart(2, '0')}</div>
      <Cover track={track} />
      <button className="track-copy" type="button" onClick={onPlay} data-testid={`button-play-track-${track.id}`} style={{ textAlign: 'left', border: 0, background: 'transparent', padding: 0 }}>
        <div className="track-title">{track.title}</div>
        <div className="track-artist">{track.artist}</div>
      </button>
      <div className="track-duration">{formatTime(track.durationSeconds)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button className={`icon-button ${favorite ? 'active' : ''}`} aria-label={favorite ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`} data-testid={`button-favorite-${track.id}`} onClick={onFavorite}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <button className="icon-button" aria-label={`Add ${track.title} to queue`} data-testid={`button-queue-${track.id}`} onClick={onQueue}><Plus size={17} /></button>
      </div>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div className="empty-orbit"><Disc3 size={23} /></div><strong>{title}</strong><p>{text}</p></div>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/user-portal" component={UserPortal} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/user-portal" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

function UserPortal() {
  return (
    <>
      <Show when="signed-in"><Home /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function AccountControls() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="auth-actions">
        <Link className="auth-link auth-link-primary" href="/sign-in">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="auth-actions">
      <span className="account-name">{user?.firstName || 'Signed in'}</span>
      <button className="auth-link" type="button" onClick={() => void signOut({ redirectUrl: basePath || '/' })}>
        Sign out
      </button>
    </div>
  );
}

function SignInPage() {
  return (
    <div className="auth-page">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="auth-page">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const nextUserId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
        queryClient.clear();
      }
      previousUserId.current = nextUserId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to keep your Loved songs in sync',
          },
        },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Save your Loved songs for your next visit',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
