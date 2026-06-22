"use client";

import { useEffect, useRef, useState } from "react";
import { ColorSwatch, ElementCompass, GarmentTag, HairGlyph } from "./vector-glyphs";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const WORKER_API_BASE =
  process.env.NEXT_PUBLIC_WORKER_API_BASE ?? "https://dressing-room-worker.YOUR_SUBDOMAIN.workers.dev";

const GEONAMES_USERNAME = process.env.NEXT_PUBLIC_GEONAMES_USERNAME ?? "demo";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface GeonamesResult {
  geonameId: number;
  name: string;
  adminName1: string;
  countryName: string;
  lat: string;
  lng: string;
  timezone?: { timeZoneId: string };
}

interface PlaceOption {
  id: number;
  label: string;
  lat: number;
  lon: number;
  timezone: string;
}

interface ColorCategory {
  hex: string;
  name: string;
}

interface ElementBalance {
  fire: number;
  air: number;
  earth: number;
  water: number;
}

interface DailyState {
  date: string;
  vibe: { text: string };
  colors: {
    work: ColorCategory;
    charm: ColorCategory;
    health: ColorCategory;
    avoid: ColorCategory;
  };
  hair: { directive: "up" | "down"; label: string };
  dominantElement: string;
  elementBalance: ElementBalance;
  cached: boolean;
}

interface ForecastOverview {
  startDate: string;
  endDate: string;
  dominantElement: string;
  elementBalance: ElementBalance;
  vibe: { text: string };
  hair: { directive: "up" | "down"; label: string };
  colors: {
    work: ColorCategory;
    charm: ColorCategory;
    health: ColorCategory;
    avoid: ColorCategory;
  };
}

interface ForecastResponse {
  overview: ForecastOverview;
  days: DailyState[];
}

type Stage = "form" | "loading" | "dashboard" | "error";
type ViewMode = "today" | "week" | "date";

// ---------------------------------------------------------------------
// Geonames lookup — restricted to Thailand (country=TH)
// ---------------------------------------------------------------------

async function searchThaiCities(query: string): Promise<PlaceOption[]> {
  if (query.trim().length < 2) return [];

  const url = new URL("https://secure.geonames.org/searchJSON");
  url.searchParams.set("name_startsWith", query);
  url.searchParams.set("country", "TH");
  url.searchParams.set("featureClass", "P"); // populated places
  url.searchParams.set("maxRows", "8");
  url.searchParams.set("orderby", "population");
  url.searchParams.set("username", GEONAMES_USERNAME);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Geonames lookup failed");
  const data = await res.json();

  const list: GeonamesResult[] = data?.geonames ?? [];

  return list.map((g) => ({
    id: g.geonameId,
    label: g.adminName1 && g.adminName1 !== g.name ? `${g.name}, ${g.adminName1}` : g.name,
    lat: parseFloat(g.lat),
    lon: parseFloat(g.lng),
    timezone: g.timezone?.timeZoneId ?? "Asia/Bangkok",
  }));
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function Page() {
  const [stage, setStage] = useState<Stage>("form");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // form fields
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<PlaceOption | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceOption[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [dailyState, setDailyState] = useState<DailyState | null>(null);
  const [personName, setPersonName] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // close suggestion list on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleCityInput(value: string) {
    setCityQuery(value);
    setSelectedPlace(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchThaiCities(value);
        setSuggestions(results);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function selectPlace(place: PlaceOption) {
    setSelectedPlace(place);
    setCityQuery(place.label);
    setShowSuggestions(false);
  }

  function validate(): string | null {
    if (!name.trim()) return "Enter a name.";
    if (!birthDate) return "Enter a birth date.";
    if (!birthTime) return "Enter a birth time.";
    if (!selectedPlace) return "Select a birth place from the list.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage("");
    setStage("loading");

    try {
      const registerRes = await fetch(`${WORKER_API_BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          birth_date: birthDate,
          birth_time: birthTime,
          birth_place: selectedPlace!.label,
          lat: selectedPlace!.lat,
          lon: selectedPlace!.lon,
          timezone: selectedPlace!.timezone,
        }),
      });

      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Registration failed.");
      }

      const { id } = await registerRes.json();

      const todayRes = await fetch(`${WORKER_API_BASE}/api/users/${id}/today`);
      if (!todayRes.ok) {
        const body = await todayRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not load today's directive.");
      }

      const todayData: DailyState = await todayRes.json();
      setUserId(id);
      setDailyState(todayData);
      setPersonName(name.trim());
      setStage("dashboard");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStage("error");
    }
  }

  if (stage === "dashboard" && dailyState) {
    return (
      <Dashboard
        name={personName}
        userId={userId}
        initialState={dailyState}
        onReset={() => setStage("form")}
      />
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-6 pt-16 pb-24">
      <div className="w-full max-w-sm">
        {/* ----- Header ----- */}
        <header className="mb-14">
          <p className="font-mono text-[11px] tracking-widest2 text-ash uppercase mb-3">
            Basil Metric — Issue No. 01
          </p>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight">
            Dressing
            <br />
            Room.
          </h1>
          <div className="hr-line mt-6 mb-4" />
          <p className="text-ash text-sm leading-relaxed">
            Enter your exact birth details. We read the transit against your
            chart and return a vibe, four lucky colours, and a hairstyle —
            today, this week, or any date you choose.
          </p>
        </header>

        {/* ----- Form ----- */}
        <form onSubmit={handleSubmit} className="space-y-7">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="w-full bg-transparent border-0 border-b border-line focus:border-bone pb-2 text-base outline-none transition-colors"
              autoComplete="name"
            />
          </Field>

          <div className="grid grid-cols-2 gap-5">
            <Field label="Birth date">
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-line focus:border-bone pb-2 text-base outline-none transition-colors"
              />
            </Field>
            <Field label="Birth time">
              <input
                type="time"
                value={birthTime}
                onChange={(e) => setBirthTime(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-line focus:border-bone pb-2 text-base outline-none transition-colors"
              />
            </Field>
          </div>

          <Field label="Birth place">
            <div className="relative" ref={wrapperRef}>
              <input
                type="text"
                value={cityQuery}
                onChange={(e) => handleCityInput(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Type a city or province in Thailand"
                className="w-full bg-transparent border-0 border-b border-line focus:border-bone pb-2 text-base outline-none transition-colors"
                autoComplete="off"
              />
              {searching && (
                <span className="absolute right-0 top-0 font-mono text-[10px] text-ash">
                  searching
                </span>
              )}

              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-2 max-h-56 overflow-y-auto thin-scroll bg-surface border border-line">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectPlace(s)}
                        className="w-full text-left px-4 py-3 text-sm hover:bg-void transition-colors flex items-center justify-between"
                      >
                        <span>{s.label}</span>
                        <span className="font-mono text-[10px] text-ash">
                          {s.lat.toFixed(2)}, {s.lon.toFixed(2)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>

          {selectedPlace && (
            <div className="font-mono text-[11px] text-ash flex items-center justify-between border border-line px-4 py-3">
              <span>{selectedPlace.timezone}</span>
              <span>
                {selectedPlace.lat.toFixed(4)}, {selectedPlace.lon.toFixed(4)}
              </span>
            </div>
          )}

          {errorMessage && (
            <p className="text-sm text-rust font-mono">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={stage === "loading"}
            className="w-full bg-bone text-void font-body font-medium text-sm tracking-wide py-4 mt-4 disabled:opacity-50 transition-opacity"
          >
            {stage === "loading" ? "Reading the chart..." : "Open the room"}
          </button>
        </form>

        <footer className="mt-16 pt-6 border-t border-line">
          <p className="font-mono text-[10px] text-ash tracking-widest2 uppercase">
            Dressing Room — Basil Metric
          </p>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] tracking-widest2 uppercase text-ash mb-3">
        {label}
      </span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------
// Dashboard — wraps Today / Week / Date views with a shared tab switcher
// ---------------------------------------------------------------------

function Dashboard({
  name,
  userId,
  initialState,
  onReset,
}: {
  name: string;
  userId: string;
  initialState: DailyState;
  onReset: () => void;
}) {
  const [view, setView] = useState<ViewMode>("today");

  const [todayState, setTodayState] = useState<DailyState>(initialState);

  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");

  const [pickedDate, setPickedDate] = useState<string>("");
  const [dateState, setDateState] = useState<DailyState | null>(null);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateError, setDateError] = useState("");

  async function loadForecast() {
    if (forecast) return; // already loaded this session
    setForecastLoading(true);
    setForecastError("");
    try {
      const res = await fetch(`${WORKER_API_BASE}/api/users/${userId}/forecast?days=7`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not load the week ahead.");
      }
      const data: ForecastResponse = await res.json();
      setForecast(data);
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setForecastLoading(false);
    }
  }

  async function loadDate(dateStr: string) {
    if (!dateStr) return;
    setDateLoading(true);
    setDateError("");
    setDateState(null);
    try {
      const res = await fetch(`${WORKER_API_BASE}/api/users/${userId}/date/${dateStr}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not load that date.");
      }
      const data: DailyState = await res.json();
      setDateState(data);
    } catch (err) {
      setDateError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDateLoading(false);
    }
  }

  function switchView(next: ViewMode) {
    setView(next);
    if (next === "week") loadForecast();
  }

  return (
    <main className="min-h-screen px-6 pt-14 pb-24">
      <div className="w-full max-w-sm mx-auto">
        {/* ----- Header ----- */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] tracking-widest2 text-ash uppercase mb-2">
              {view === "today" && formatLongDate(todayState.date)}
              {view === "week" && forecast && `${formatShortDate(forecast.overview.startDate)} — ${formatShortDate(forecast.overview.endDate)}`}
              {view === "week" && !forecast && "Week ahead"}
              {view === "date" && (dateState ? formatLongDate(dateState.date) : "Pick a date")}
            </p>
            <h1 className="font-display text-2xl leading-tight">
              For {name.split(" ")[0]}.
            </h1>
          </div>
          <GarmentTag
            direction={
              view === "today"
                ? todayState.hair.directive
                : view === "week"
                ? forecast?.overview.hair.directive ?? "down"
                : dateState?.hair.directive ?? "down"
            }
            size={48}
          />
        </header>

        {/* ----- Tab switcher ----- */}
        <div className="flex border border-line mb-10">
          <TabButton active={view === "today"} onClick={() => switchView("today")}>
            Today
          </TabButton>
          <TabButton active={view === "week"} onClick={() => switchView("week")}>
            Week Ahead
          </TabButton>
          <TabButton active={view === "date"} onClick={() => switchView("date")}>
            Pick a Date
          </TabButton>
        </div>

        {/* ----- Today view ----- */}
        {view === "today" && <DailyDetail state={todayState} />}

        {/* ----- Week view ----- */}
        {view === "week" && (
          <WeekView
            forecast={forecast}
            loading={forecastLoading}
            error={forecastError}
          />
        )}

        {/* ----- Date picker view ----- */}
        {view === "date" && (
          <div>
            <Field label="Choose a date">
              <input
                type="date"
                value={pickedDate}
                onChange={(e) => {
                  setPickedDate(e.target.value);
                  loadDate(e.target.value);
                }}
                className="w-full bg-transparent border-0 border-b border-line focus:border-bone pb-2 text-base outline-none transition-colors"
              />
            </Field>

            <div className="mt-10">
              {dateLoading && (
                <p className="font-mono text-xs text-ash uppercase tracking-widest2">
                  Reading the chart...
                </p>
              )}
              {dateError && <p className="text-sm text-rust font-mono">{dateError}</p>}
              {!dateLoading && !dateError && dateState && <DailyDetail state={dateState} />}
              {!dateLoading && !dateError && !dateState && (
                <p className="text-ash text-sm">
                  Pick any date above to see that day&apos;s vibe, colours, and hairstyle directive.
                </p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onReset}
          className="w-full border border-line text-bone font-body text-sm tracking-wide py-4 mt-12 transition-colors hover:border-bone"
        >
          Read for someone else
        </button>

        <footer className="mt-16 pt-6 border-t border-line">
          <p className="font-mono text-[10px] text-ash tracking-widest2 uppercase">
            Dressing Room — Basil Metric
          </p>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 font-mono text-[10px] tracking-widest2 uppercase transition-colors ${
        active ? "bg-bone text-void" : "text-ash hover:text-bone"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Shared single-day detail block (used by Today and Date views)
// ---------------------------------------------------------------------

function DailyDetail({ state }: { state: DailyState }) {
  return (
    <div>
      {/* ----- Panel 01: Vibe ----- */}
      <section className="mb-12">
        <PanelLabel index="01" title="Vibe of the day" />
        <p className="font-display text-xl italic leading-snug mt-4">
          &ldquo;{state.vibe.text}&rdquo;
        </p>
      </section>

      {/* ----- Panel 02: Lucky colours ----- */}
      <section className="mb-12">
        <PanelLabel index="02" title="Lucky colours" />
        <div className="grid grid-cols-2 gap-5 mt-5">
          <ColorCategoryBlock label="Work" category={state.colors.work} />
          <ColorCategoryBlock label="Charm" category={state.colors.charm} />
          <ColorCategoryBlock label="Health" category={state.colors.health} />
          <ColorCategoryBlock label="Avoid" category={state.colors.avoid} muted />
        </div>
      </section>

      {/* ----- Panel 03: Hairstyle ----- */}
      <section className="mb-12">
        <PanelLabel index="03" title="Hairstyle directive" />
        <div className="mt-5 flex items-center gap-5">
          <div className="border border-line p-4">
            <HairGlyph direction={state.hair.directive} size={36} />
          </div>
          <p className="text-lg">{state.hair.label}</p>
        </div>
      </section>

      <div className="hr-line mb-10" />

      {/* ----- Element balance ----- */}
      <section>
        <PanelLabel index="04" title="Element balance" />
        <div className="mt-5 flex items-center justify-center">
          <ElementCompass balance={state.elementBalance} size={140} />
        </div>
        <p className="text-center font-mono text-[11px] text-ash mt-4 uppercase tracking-widest2">
          Dominant — {state.dominantElement}
        </p>
      </section>
    </div>
  );
}

function ColorCategoryBlock({
  label,
  category,
  muted = false,
}: {
  label: string;
  category: ColorCategory;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <ColorSwatch hex={category.hex} size={52} />
      <div>
        <p className={`font-mono text-[10px] tracking-widest2 uppercase ${muted ? "text-rust" : "text-ash"}`}>
          {label}
        </p>
        <p className="text-sm mt-1">{category.name}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Week view — overview card + horizontal scroll of daily cards
// ---------------------------------------------------------------------

function WeekView({
  forecast,
  loading,
  error,
}: {
  forecast: ForecastResponse | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <p className="font-mono text-xs text-ash uppercase tracking-widest2">
        Reading the week ahead...
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-rust font-mono">{error}</p>;
  }

  if (!forecast) return null;

  return (
    <div>
      {/* ----- Weekly overview ----- */}
      <section className="mb-10 border border-line p-5">
        <p className="font-mono text-[10px] tracking-widest2 uppercase text-ash mb-3">
          Overview
        </p>
        <p className="font-display text-lg italic leading-snug mb-5">
          &ldquo;{forecast.overview.vibe.text}&rdquo;
        </p>
        <div className="grid grid-cols-2 gap-4">
          <ColorCategoryBlock label="Work" category={forecast.overview.colors.work} />
          <ColorCategoryBlock label="Charm" category={forecast.overview.colors.charm} />
          <ColorCategoryBlock label="Health" category={forecast.overview.colors.health} />
          <ColorCategoryBlock label="Avoid" category={forecast.overview.colors.avoid} muted />
        </div>
        <div className="hr-line my-5" />
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] text-ash uppercase tracking-widest2">
            Dominant — {forecast.overview.dominantElement}
          </p>
          <div className="flex items-center gap-2">
            <HairGlyph direction={forecast.overview.hair.directive} size={20} />
            <p className="text-sm">{forecast.overview.hair.label}</p>
          </div>
        </div>
      </section>

      {/* ----- Daily cards ----- */}
      <p className="font-mono text-[10px] tracking-widest2 uppercase text-ash mb-4">
        Day by day
      </p>
      <div className="flex gap-4 overflow-x-auto thin-scroll pb-2 -mx-6 px-6">
        {forecast.days.map((day) => (
          <DayCard key={day.date} state={day} />
        ))}
      </div>
    </div>
  );
}

function DayCard({ state }: { state: DailyState }) {
  return (
    <div className="flex-shrink-0 w-44 border border-line p-4">
      <p className="font-mono text-[10px] tracking-widest2 uppercase text-ash mb-1">
        {formatShortDate(state.date)}
      </p>
      <p className="font-display text-sm italic leading-snug mb-4 line-clamp-3">
        &ldquo;{state.vibe.text}&rdquo;
      </p>

      <div className="flex gap-2 mb-4">
        <MiniSwatch hex={state.colors.work.hex} label="Work" />
        <MiniSwatch hex={state.colors.charm.hex} label="Charm" />
        <MiniSwatch hex={state.colors.health.hex} label="Health" />
        <MiniSwatch hex={state.colors.avoid.hex} label="Avoid" />
      </div>

      <div className="flex items-center gap-2">
        <HairGlyph direction={state.hair.directive} size={18} />
        <p className="font-mono text-[10px] text-ash uppercase tracking-widest2">
          {state.hair.label}
        </p>
      </div>
    </div>
  );
}

function MiniSwatch({ hex, label }: { hex: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <div
        className="w-6 h-6 border border-line"
        style={{ backgroundColor: hex }}
        role="img"
        aria-label={`${label} colour swatch`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Shared label + date formatting
// ---------------------------------------------------------------------

function PanelLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[11px] text-ash">{index}</span>
      <span className="font-mono text-[11px] tracking-widest2 uppercase text-ash">
        {title}
      </span>
    </div>
  );
}

function formatLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
