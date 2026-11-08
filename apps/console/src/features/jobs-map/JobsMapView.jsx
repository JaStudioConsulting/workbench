import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Copy, Check, MapPin, RefreshCw, Search, SlidersHorizontal, ArrowRight, ShieldCheck, X, CircleDollarSign, UserRoundSearch } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { calculateDistance, expandAndEnrichJobs } from "./geo-utils.js";
import { createJobMarkerHtml, createSearchCandidateMarkerHtml } from "./map-markers.js";
import { copyJobPitchToClipboard, generateJobPitch } from "./pitch-formatter.js";
import { supabase } from "../../supabase-client.js";

const DEFAULT_CENTER = [43.6532, -79.3832]; // Toronto, ON
const DEFAULT_ZOOM = 10;

export default function JobsMapView({ onSelectJobForWorkflow, onOpenJobReview }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState("loading"); // "live" | "unavailable"
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCoords, setSearchCoords] = useState(null);
  const [searchAddressName, setSearchAddressName] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [keywordFilter, setKeywordFilter] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("ALL");
  const [maxRadius, setMaxRadius] = useState("ALL");
  const [unit, setUnit] = useState("km");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [selectedJob, setSelectedJob] = useState(null);
  const [copiedPitch, setCopiedPitch] = useState(false);
  const [mobileTab, setMobileTab] = useState("split"); // "split" | "list" | "map"

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef({});
  const searchMarkerRef = useRef(null);
  const radiusCircleRef = useRef(null);

  // 1. Initial Load of Jobs
  const loadJobs = async () => {
    setLoading(true);
    try {
      // Attempt authenticated gateway sync via Google Sheets API
      const res = await fetch("/api/gws/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "sheets",
          spreadsheetId: "1RexJFAEWRwNjzeGThutrA0zMObu2g4r3q0Vu0uiDbQs",
          range: "Jobs!A1:K100",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rows) && data.rows.length > 1) {
          const headers = data.rows[0];
          const rawObjects = data.rows.slice(1).map((row) => {
            const obj = {};
            headers.forEach((h, i) => {
              obj[h] = row[i] || "";
            });
            return obj;
          });
          const active = rawObjects.filter((j) => (j["Status"] || j.status || "").toLowerCase() === "active");
          setJobs(expandAndEnrichJobs(active));
          setDataSource("live");
          setLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to the authenticated Supabase snapshot.
    }

    const { data: trackerJobs, error: trackerError } = await supabase
      .from("tracker_jobs")
      .select("job_id,job_title,company,location,compensation,date_opened,owners,status,job_description,loxo_link")
      .eq("status", "Active")
      .order("date_opened", { ascending: false, nullsFirst: false });

    if (!trackerError && trackerJobs?.length) {
      const sourceRows = trackerJobs.map((job) => ({
        "Job ID": String(job.job_id),
        "Job Title": job.job_title,
        Company: job.company || "",
        Location: job.location || "",
        Compensation: job.compensation || "",
        "Date Opened": job.date_opened || "",
        Owners: job.owners || "",
        Status: job.status || "",
        "Job Description": job.job_description || "",
        "Loxo Link": job.loxo_link || "",
      }));
      setJobs(expandAndEnrichJobs(sourceRows));
      setDataSource("live");
      setLoading(false);
      return;
    }

    // Honest empty state. Never replace unavailable live data with fixtures.
    setJobs([]);
    setDataSource("unavailable");
    setLoading(false);
  };

  useEffect(() => {
    loadJobs();
  }, []);

  // 2. Dynamic Leaflet Map Initialization (safe for SSR / Sites worker builds)
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapContainerRef.current || mapInstanceRef.current) return;
      try {
        const L = (await import("leaflet")).default;
        await import("leaflet/dist/leaflet.css");
        if (!isMounted || !mapContainerRef.current) return;

        leafletRef.current = L;
        const map = L.map(mapContainerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
          preferCanvas: true,
        });

        L.control.zoom({ position: "bottomright" }).addTo(map);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Top Tier Talent Group',
          maxZoom: 19,
        }).addTo(map);

        mapInstanceRef.current = map;

        setTimeout(() => {
          if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
        }, 200);
      } catch (err) {
        console.warn("Leaflet map initialization notice:", err);
      }
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Keep Leaflet's cached size in sync with its container. Without this, the
  // tile grid freezes at its last-known size and newly exposed space (e.g.
  // after the sidebar is toggled) renders as empty tile-grid lines.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      mapInstanceRef.current?.invalidateSize();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // 3. Unique Recruiter Owners
  const uniqueOwners = useMemo(() => {
    const set = new Set();
    jobs.forEach((j) => {
      const owners = j.owners || j["Owners"] || "";
      owners.split(",").forEach((o) => {
        const trimmed = o.trim();
        if (trimmed) set.add(trimmed);
      });
    });
    return Array.from(set).sort();
  }, [jobs]);

  // 4. Proximity & Filtering Calculation
  const filteredJobs = useMemo(() => {
    return jobs
      .map((job) => {
        let distance = null;
        if (searchCoords && job.coords) {
          distance = calculateDistance(searchCoords[0], searchCoords[1], job.coords[0], job.coords[1], unit);
        }
        return { ...job, distance };
      })
      .filter((job) => {
        if (keywordFilter.trim()) {
          const kw = keywordFilter.toLowerCase();
          const matchTitle = (job.title || "").toLowerCase().includes(kw);
          const matchCompany = (job.company || "").toLowerCase().includes(kw);
          const matchLoc = (job.displayLocation || "").toLowerCase().includes(kw);
          const matchDesc = (job.description || "").toLowerCase().includes(kw);
          if (!matchTitle && !matchCompany && !matchLoc && !matchDesc) return false;
        }

        if (selectedOwner !== "ALL") {
          const owners = (job.owners || "").split(",").map((o) => o.trim());
          if (!owners.includes(selectedOwner)) return false;
        }

        if (searchCoords && maxRadius !== "ALL") {
          // A job without resolvable coordinates cannot be proven inside the
          // radius, so it is excluded instead of silently passing the filter.
          if (job.distance === null) return false;
          if (job.distance > parseInt(maxRadius, 10)) return false;
        }

        if (regionFilter === "ONTARIO") {
          const [lat, lng] = job.coords || [0, 0];
          const isOntCoords = lat >= 41.5 && lat <= 46.5 && lng >= -84.0 && lng <= -74.0;
          const isOntText = /\b(on|ontario|toronto|windsor|mississauga|brampton|hamilton|london|kitchener|waterloo|markham|vaughan|ottawa|cambridge|guelph|barrie|oakville|burlington|oshawa|belleville)\b/i.test(
            job.displayLocation || job.rawLocation || "",
          );
          if (!isOntCoords && !isOntText) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (searchCoords) {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        }
        return 0;
      });
  }, [jobs, searchCoords, keywordFilter, selectedOwner, maxRadius, unit, regionFilter]);

  const unmappedJobCount = useMemo(
    () => jobs.filter((job) => !job.coords).length,
    [jobs],
  );

  // 5. Sync Markers on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Clear previous job markers
    Object.values(markersRef.current).forEach((m) => map.removeLayer(m));
    markersRef.current = {};

    const coordsToFit = [];

    filteredJobs.forEach((job) => {
      if (!job.coords) return;
      const isSelected = selectedJob?.id === job.id;
      const icon = L.divIcon({
        html: createJobMarkerHtml(job, isSelected),
        className: "custom-job-pin",
        iconSize: [32, 38],
        iconAnchor: [16, 38],
      });

      const marker = L.marker(job.coords, { icon })
        .bindTooltip(
          `<strong>${job.title}</strong><br/><span style="color:#666">${job.company}</span><br/><em>${job.displayLocation}</em>`,
          { direction: "top", offset: [0, -36] },
        )
        .on("click", () => {
          setSelectedJob(job);
        });

      marker.addTo(map);
      markersRef.current[job.id] = marker;
      coordsToFit.push(job.coords);
    });

    if (searchCoords) {
      coordsToFit.push(searchCoords);
    }

    if (coordsToFit.length > 0 && !selectedJob && !searchCoords) {
      map.fitBounds(coordsToFit, { padding: [40, 40], maxZoom: 12 });
    }
  }, [filteredJobs, selectedJob, searchCoords]);

  // 6. Handle Address Typeahead Search via Photon
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&limit=5&lat=43.7&lon=-79.4`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.features)) {
          const items = data.features.map((f) => {
            const props = f.properties || {};
            const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const mainText = props.name || props.street || props.city || "Location";
            const secondaryText = [props.city, props.state, props.country].filter(Boolean).join(", ");
            return { id: f.properties.osm_id || Math.random(), mainText, secondaryText, coords };
          });
          setSuggestions(items);
        }
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSuggestion = (item) => {
    const display = `${item.mainText}${item.secondaryText ? `, ${item.secondaryText}` : ""}`;
    setSearchQuery(display);
    setSearchCoords(item.coords);
    setSearchAddressName(item.mainText);
    setSuggestions([]);
    setShowSuggestions(false);

    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (map && L) {
      if (searchMarkerRef.current) map.removeLayer(searchMarkerRef.current);
      if (radiusCircleRef.current) map.removeLayer(radiusCircleRef.current);

      const icon = L.divIcon({
        html: createSearchCandidateMarkerHtml(item.mainText),
        className: "custom-candidate-pin",
        iconSize: [34, 40],
        iconAnchor: [17, 40],
      });

      searchMarkerRef.current = L.marker(item.coords, { icon, zIndexOffset: 1000 })
        .bindTooltip(`<strong>Candidate Location</strong><br/>${item.mainText}`, { permanent: true, direction: "bottom" })
        .addTo(map);

      if (maxRadius !== "ALL") {
        const radiusMeters = parseInt(maxRadius, 10) * (unit === "mi" ? 1609.34 : 1000);
        radiusCircleRef.current = L.circle(item.coords, {
          radius: radiusMeters,
          color: "#2B2723",
          fillColor: "#787165",
          fillOpacity: 0.1,
          weight: 1.5,
          dashArray: "4, 6",
        }).addTo(map);
      }

      map.flyTo(item.coords, 10, { duration: 0.8 });
    }
  };

  const clearCandidateSearch = () => {
    setSearchQuery("");
    setSearchCoords(null);
    setSearchAddressName("");
    setSuggestions([]);
    if (mapInstanceRef.current) {
      if (searchMarkerRef.current) mapInstanceRef.current.removeLayer(searchMarkerRef.current);
      if (radiusCircleRef.current) mapInstanceRef.current.removeLayer(radiusCircleRef.current);
    }
  };

  const handleSelectJobCard = (job) => {
    setSelectedJob(job);
    if (job.coords && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo(job.coords, 11, { duration: 0.8 });
      const m = markersRef.current[job.id];
      if (m) m.openTooltip();
    }
  };

  const handleCopyPitch = async () => {
    if (!selectedJob) return;
    const ok = await copyJobPitchToClipboard(selectedJob);
    if (ok) {
      setCopiedPitch(true);
      setTimeout(() => setCopiedPitch(false), 2000);
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[600px] w-full flex-col gap-3" data-testid="jobs-map-feature">
      {/* 1. Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">Jobs Map & Proximity Radar</h2>
            <p className="text-xs text-muted-foreground">Spatial matching and distance radius ranking</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={dataSource === "live" ? "secondary" : "outline"} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${dataSource === "live" ? "bg-emerald-500" : dataSource === "loading" ? "bg-amber-500" : "bg-rose-500"}`} />
            {dataSource === "live" ? "Tracker via Supabase" : dataSource === "loading" ? "Loading Tracker" : "Tracker unavailable"}
          </Badge>

          <Button size="sm" variant="outline" onClick={loadJobs} disabled={loading} title="Refresh jobs data">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Sync</span>
          </Button>

          {/* Mobile View Toggles */}
          <div className="flex md:hidden rounded-lg border bg-muted p-0.5 text-xs">
            <button
              onClick={() => setMobileTab("list")}
              className={`px-2.5 py-1 rounded-md transition ${mobileTab === "list" ? "bg-background shadow font-semibold" : "text-muted-foreground"}`}
            >
              List
            </button>
            <button
              onClick={() => setMobileTab("map")}
              className={`px-2.5 py-1 rounded-md transition ${mobileTab === "map" ? "bg-background shadow font-semibold" : "text-muted-foreground"}`}
            >
              Map
            </button>
          </div>
        </div>
      </div>

      {/* 2. Filter & Candidate Search Bar */}
      <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-6">
        {/* Candidate Location Typeahead */}
        <div className="relative lg:col-span-2">
          <div className="flex items-center relative">
            <MapPin size={15} className="absolute left-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Candidate city or address..."
              className="pl-9 pr-8 text-xs"
            />
            {searchQuery ? (
              <button onClick={clearCandidateSearch} className="absolute right-2.5 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            ) : null}
          </div>

          {/* Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
              {suggestions.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelectSuggestion(item)}
                  className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-xs hover:bg-accent"
                >
                  <MapPin size={14} className="mt-0.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{item.mainText}</p>
                    {item.secondaryText && <p className="text-[11px] text-muted-foreground truncate">{item.secondaryText}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Keyword Filter */}
        <div>
          <Input
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            placeholder="Filter title/skill..."
            className="text-xs"
          />
        </div>

        {/* Recruiter Owner Filter */}
        <div>
          <Select value={selectedOwner} onValueChange={setSelectedOwner}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="All Owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">All Owners</SelectItem>
                {uniqueOwners.map((owner) => (
                  <SelectItem key={owner} value={owner}>
                    {owner}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Radius Filter */}
        <div>
          <Select value={maxRadius} onValueChange={setMaxRadius} disabled={!searchCoords}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Any Radius" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">Any Distance</SelectItem>
                <SelectItem value="25">Within 25 {unit}</SelectItem>
                <SelectItem value="50">Within 50 {unit}</SelectItem>
                <SelectItem value="100">Within 100 {unit}</SelectItem>
                <SelectItem value="250">Within 250 {unit}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Unit Toggle & Region */}
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-md border bg-muted p-0.5 text-xs">
            <button
              onClick={() => setUnit("km")}
              className={`px-2 py-0.5 rounded transition ${unit === "km" ? "bg-background shadow font-semibold" : "text-muted-foreground"}`}
            >
              km
            </button>
            <button
              onClick={() => setUnit("mi")}
              className={`px-2 py-0.5 rounded transition ${unit === "mi" ? "bg-background shadow font-semibold" : "text-muted-foreground"}`}
            >
              mi
            </button>
          </div>

          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">All Regions</SelectItem>
                <SelectItem value="ONTARIO">Ontario Only</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 3. Main Split View (Job List + Map Viewport) */}
      <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-12 overflow-hidden">
        {/* Left Column: Ranked Jobs List */}
        <div className={`md:col-span-5 lg:col-span-4 flex flex-col gap-2 overflow-hidden ${mobileTab === "map" ? "hidden md:flex" : "flex"}`}>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-muted-foreground">
              {filteredJobs.length} {filteredJobs.length === 1 ? "Role" : "Roles"} Found
              {searchCoords ? ` · Ranked by proximity to ${searchAddressName}` : ""}
            </p>
          </div>
          {unmappedJobCount > 0 ? (
            <p className="px-1 text-[11px] text-amber-700" role="status">
              {unmappedJobCount} {unmappedJobCount === 1 ? "role has" : "roles have"} no resolvable location and {unmappedJobCount === 1 ? "is" : "are"} not shown on the map
              {searchCoords && maxRadius !== "ALL" ? "; excluded from the radius filter." : "."}
            </p>
          ) : null}

          <ScrollArea className="flex-1 rounded-lg border bg-card p-2">
            <div className="flex flex-col gap-2">
              {filteredJobs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No roles match current search and radius criteria.
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const isSelected = selectedJob?.id === job.id;
                  return (
                    <Card
                      key={job.id}
                      onClick={() => handleSelectJobCard(job)}
                      className={`cursor-pointer transition hover:border-foreground/40 ${
                        isSelected ? "border-primary bg-primary/5 shadow-sm" : ""
                      }`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-semibold truncate leading-snug">{job.title}</h4>
                            <p className="text-xs text-muted-foreground truncate">{job.company}</p>
                          </div>
                          {job.distance !== null && (
                            <Badge variant="secondary" className="shrink-0 text-xs font-mono">
                              {job.distance} {unit}
                            </Badge>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin size={12} /> {job.displayLocation}
                          </span>
                          {job.isMultiLocation && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1">
                              Site {job.locationIndex}/{job.totalLocations}
                            </Badge>
                          )}
                          {job.compensation && (
                            <span className="font-medium text-foreground">· {job.compensation}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Column: Interactive Map + Slide-out Drawer */}
        <div className={`md:col-span-7 lg:col-span-8 relative flex flex-col rounded-lg border overflow-hidden ${mobileTab === "list" ? "hidden md:flex" : "flex"}`}>
          <div ref={mapContainerRef} className="h-full w-full min-h-[400px] z-10" />

          {/* Job Details Drawer */}
          {selectedJob && (
            <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-[380px] z-20 rounded-xl border bg-card/95 backdrop-blur p-4 shadow-xl">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      ID: {selectedJob.originalJobId}
                    </Badge>
                    {selectedJob.isMultiLocation && (
                      <Badge variant="secondary" className="text-[10px]">
                        Multi-Site Opening
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-base font-bold truncate mt-1">{selectedJob.title}</h3>
                  <p className="text-xs text-muted-foreground">{selectedJob.company}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedJob(null)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close job details"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
                <p className="flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong>Location:</strong> {selectedJob.displayLocation}</span></p>
                {selectedJob.compensation && (
                  <p className="flex items-start gap-1.5"><CircleDollarSign size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong>Compensation:</strong> {selectedJob.compensation}</span></p>
                )}
                {selectedJob.owners && (
                  <p className="flex items-start gap-1.5"><UserRoundSearch size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong>Recruiter:</strong> {selectedJob.owners}</span></p>
                )}
              </div>

              {selectedJob.description && (
                <div className="mt-2.5 max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {selectedJob.description}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={handleCopyPitch} className="flex-1 text-xs">
                  {copiedPitch ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span>{copiedPitch ? "Pitch Copied" : "Copy Pitch"}</span>
                </Button>

                {onSelectJobForWorkflow && (
                  <Button
                    size="sm"
                    onClick={() => onSelectJobForWorkflow(selectedJob)}
                    className="flex-1 text-xs"
                  >
                    <span>Use for Drafting</span>
                    <ArrowRight size={14} />
                  </Button>
                )}
                {onOpenJobReview && (
                  <Button size="sm" variant="outline" onClick={() => onOpenJobReview(selectedJob)} className="flex-1 text-xs">
                    <span>Review fit</span>
                    <UserRoundSearch size={14} />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
