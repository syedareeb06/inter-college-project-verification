/* ProjectLedger - Consortium Blockchain for Inter-College Project Verification (web app) */
(function () {
  const C = window.ProjectLedgerCrypto;
  const S = window.ProjectLedgerSamples;

  const ST = { Pending: 0, Verified: 1, Disputed: 2, Rejected: 3, Revoked: 4, Expired: 5 };
  const STATUS_UI = [
    { label: "Awaiting endorsements", chip: "chip-warn" },
    { label: "Verified", chip: "chip-ok" },
    { label: "Disputed", chip: "chip-bad" },
    { label: "Rejected", chip: "chip-bad" },
    { label: "Revoked", chip: "" },
    { label: "Review window closed", chip: "" },
  ];
  const DAY = 86400;
  const BOARD_NAME = "University Consortium Board";

  const esc = UI.esc;
  const lower = (a) => (a || "").toLowerCase();
  const sameAddr = (a, b) => lower(a) === lower(b);
  const board = () => Chain.accounts[0];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const statusName = (st) => (STATUS_UI[Number(st)] ? STATUS_UI[Number(st)].label.toLowerCase() : "in another state");

  let lastData = null; // latest load(), used by error messages and the explorer
  const titleOf = (id) => {
    const p = lastData && lastData.project(Number(id));
    return p ? ` ("${p.title}", ${Chain.label(p.college)})` : "";
  };

  const ERRORS = {
    NotBoard: () => "only the University Consortium Board can do this.",
    NotActiveCollege: () => "this account is not an active consortium college.",
    InvalidCollege: () => "invalid college details: an account, a name and a code are required, and the board cannot be a college.",
    AlreadyCollege: (a) => `${Chain.label(a)} is already a member college.`,
    CodeTaken: (code) => `the college code "${code}" is already in use.`,
    UnknownCollege: (a) => `${Chain.label(a)} is not a consortium college.`,
    InvalidThreshold: (k, n) => `the endorsement threshold must be between 2 and the number of active colleges (${n}); ${k} is not allowed.`,
    InvalidProject: () => "a project needs a title, a report hash, a team hash and a year between 2000 and 2100.",
    InvalidFingerprint: (len) => `the similarity fingerprint must be 128 bytes (got ${len}).`,
    DuplicateReport: (id) => `this exact report is already registered as project #${id}${titleOf(id)}.`,
    UnknownProject: (id) => `project #${id} does not exist.`,
    InvalidReference: (id) => `project #${id} cannot be referenced here.`,
    OwnProject: (id) => `a college cannot endorse or flag its own project (#${id}).`,
    AlreadyEndorsed: (id) => `this college has already endorsed project #${id}.`,
    NotEndorsable: (id, st) => `project #${id} is ${statusName(st)} and cannot be endorsed.`,
    ReviewClosed: (id, deadline) => `the 30-day review window for project #${id} closed on ${UI.fmtTime(deadline)}.`,
    NotFlaggable: (id, st) => `project #${id} is ${statusName(st)} and cannot be flagged.`,
    EmptyReason: () => "a reason or ruling note is required.",
    NotDisputed: (id) => `project #${id} has no open dispute.`,
    NotProjectOwner: (id) => `only the college that registered project #${id} can revoke it.`,
    CannotRevoke: (id, st) => `project #${id} is ${statusName(st)} and cannot be revoked.`,
  };

  // ------------------------------------------------------------------
  // Built-in samples (texts, hashes, fingerprints, demo salts)
  // ------------------------------------------------------------------
  let samplesP = null;
  const sampleByHash = new Map();
  function samplesReady() {
    if (!samplesP)
      samplesP = Promise.all(
        S.SAMPLES.map(async (s) => {
          const text = S.reportText(s);
          const info = {
            ...s,
            text,
            hash: await C.reportHash(text),
            sig: C.minhash(text).sig,
            salt: await C.demoSalt(s.key),
            team: s.members.map(([name, roll]) => ({ name, roll })),
          };
          sampleByHash.set(info.hash, info);
          return info;
        })
      );
    return samplesP;
  }
  const sampleRegistration = (info, similarToId = 0) =>
    C.buildRegistration({ title: info.title, domain: info.domain, year: info.year, guide: info.guide, text: info.text, members: info.team, salt: info.salt, similarToId });

  // ------------------------------------------------------------------
  // Off-chain data kept by each college (simulated per chain instance)
  // ------------------------------------------------------------------
  const reportsStore = () => Chain.store.get("reports", {});
  function saveReport(hash, text) {
    const all = reportsStore();
    all[hash] = text;
    Chain.store.set("reports", all);
  }
  const teamsStore = () => Chain.store.get("teams", {});
  function saveTeam(id, record) {
    const all = teamsStore();
    all[id] = record;
    Chain.store.set("teams", all);
  }
  const reportTextOf = (p) => reportsStore()[p.reportHash] || (sampleByHash.get(p.reportHash) || {}).text || null;
  function teamRecordOf(p) {
    const t = teamsStore()[p.id];
    if (t) return t;
    const s = sampleByHash.get(p.reportHash);
    return s && sameAddr(Chain.accounts[s.college], p.college) ? { salt: s.salt, members: s.team } : null;
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  async function load() {
    await samplesReady();
    const c = Chain.contract;
    const [accts, infos] = await c.getColleges();
    const colleges = accts.map((a, i) => ({
      address: a,
      name: infos[i].name,
      code: infos[i].code,
      active: infos[i].active,
      joinedAt: Number(infos[i].joinedAt),
    }));
    Chain.setName(board(), BOARD_NAME);
    colleges.forEach((m) => Chain.setName(m.address, m.name));

    const [count, threshold, active, fps] = await Promise.all([c.projectCount(), c.threshold(), c.activeColleges(), c.getAllFingerprints()]);
    const projects = await Promise.all(
      Array.from({ length: Number(count) }, async (_, i) => {
        const id = i + 1;
        const [p, status, ends, flags] = await Promise.all([c.getProject(id), c.statusOf(id), c.getEndorsements(id), c.getFlags(id)]);
        return {
          id,
          college: p.college,
          year: Number(p.year),
          stored: Number(p.status),
          status: Number(status),
          endorsements: Number(p.endorsements),
          required: Number(p.required),
          registeredAt: Number(p.registeredAt),
          reviewDeadline: Number(p.reviewDeadline),
          verifiedAt: Number(p.verifiedAt),
          reportHash: p.reportHash,
          teamHash: p.teamHash,
          similarToId: Number(p.similarToId),
          title: p.title,
          domain: p.domain,
          teamDisplay: p.teamDisplay,
          guide: p.guide,
          note: p.note,
          endorsers: [...ends],
          flags: flags.map((f) => ({ college: f.college, similarToId: Number(f.similarToId), reason: f.reason, time: Number(f.time) })),
          fingerprint: fps[i],
          sig: C.parseFingerprint(fps[i]),
        };
      })
    );
    const data = {
      colleges,
      threshold: Number(threshold),
      activeColleges: Number(active),
      projects,
      project: (id) => projects[Number(id) - 1],
      college: (a) => colleges.find((x) => sameAddr(x.address, a)),
    };
    lastData = data;
    return data;
  }

  const collegeName = (addr) => Chain.label(addr);
  const collegeCode = (data, addr) => (data.college(addr) || {}).code || "?";
  const statusChip = (p) => `<span class="chip ${STATUS_UI[p.status].chip}">${STATUS_UI[p.status].label}</span>`;
  const memberChip = (m) => (m.active ? `<span class="chip chip-ok">Active</span>` : `<span class="chip chip-bad">Suspended</span>`);
  const meter = (p) => {
    const w = Math.min(100, Math.round((p.endorsements / p.required) * 100));
    return `<span class="meter-wrap"><span class="meter" aria-hidden="true"><span style="width:${w}%"></span></span><span>${p.endorsements} of ${p.required}</span></span>`;
  };
  const verifyUrl = (id) => `${location.href.split("#")[0]}#/verify?id=${id}`;

  /** All projects ranked by MinHash similarity to a signature. */
  function scan(sig, data, excludeId = 0) {
    return data.projects
      .filter((p) => p.id !== excludeId && p.sig)
      .map((p) => ({ p, score: C.similarity(sig, p.sig).score }))
      .sort((a, b) => b.score - a.score || a.p.id - b.p.id);
  }
  function simChip(score, p) {
    const cls = score >= C.NEAR_DUP ? "chip-bad" : score >= C.RELATED ? "chip-warn" : "chip-ok";
    const what = p ? ` to #${p.id}` : "";
    return `<span class="chip ${cls}">${pct(score)} similar${what}${score >= C.NEAR_DUP ? " · near-duplicate" : ""}</span>`;
  }

  // ------------------------------------------------------------------
  // Core actions
  // ------------------------------------------------------------------
  /** Input check for the registration form; returns an error message or "". */
  function formProblem(form) {
    const text = C.normalizeReport(form.text);
    const members = C.parseMembers(form.members);
    const year = Number(form.year);
    if (!(form.title || "").trim()) return "Enter the project title.";
    if (text.length > C.MAX_TEXT) return "The report is too long for this demo (200,000 characters at most).";
    if (C.analyse(text).words < 60) return "The report text is too short (at least 60 words are needed for a meaningful fingerprint).";
    if (!members.length || members.some((m) => !m.name || !m.roll)) return 'List every team member as "Name, Roll number" (one per line).';
    if (!(year >= 2000 && year <= 2100)) return "Enter a year between 2000 and 2100.";
    return "";
  }

  /** Register a project with live steps: hash -> fingerprint -> similarity scan -> team hash -> transaction. */
  async function registerProject(collegeAddr, form, data, { declareSimilar = 0 } = {}) {
    const s = Shell.state;
    const problem = formProblem(form);
    if (problem) throw new Error(problem);
    const text = C.normalizeReport(form.text);
    const title = form.title.trim();
    const members = C.parseMembers(form.members);
    const year = Number(form.year);

    let reportHash, mh, fpHex, exact, salt, tHash, id, warn = null;
    const host = document.getElementById("reg-steps");
    const nColleges = new Set(data.projects.map((p) => lower(p.college))).size;
    const run = await UI.runSteps(host, [
      {
        title: "Hash the report (SHA-256)",
        run: async () => {
          reportHash = await C.reportHash(text);
          exact = Number(await Chain.contract.findByReportHash(reportHash));
          return `${UI.short(reportHash, 10)} · ${exact ? `identical to project #${exact} on the ledger` : "no identical report on the ledger"}`;
        },
      },
      {
        title: "Build the MinHash fingerprint (3-word shingles, 32 hash functions)",
        run: async () => {
          mh = C.minhash(text);
          fpHex = C.fingerprintHex(mh.sig);
          return `${mh.words} words → ${mh.contentWords} content words → ${mh.shingles} shingles → 32 × uint32 (128 bytes): ${fpHex.slice(2, 26)}…`;
        },
      },
      {
        title: `Similarity scan against ${data.projects.length} projects from ${nColleges} colleges`,
        run: async () => {
          const top = scan(mh.sig, data)[0];
          if (exact) return `Exact copy of #${exact} (100%). Sending anyway: the smart contract itself refuses duplicate report hashes.`;
          if (!top || top.score < C.RELATED) return `Highest similarity ${pct(top ? top.score : 0)}${top ? ` (#${top.p.id})` : ""}: no near-duplicates.`;
          if (top.score >= C.NEAR_DUP) {
            if (declareSimilar === top.p.id)
              return `${pct(top.score)} similar to #${top.p.id} "${top.p.title}" (${collegeName(top.p.college)}). Declared on-chain as similarToId = ${top.p.id}.`;
            warn = { id: top.p.id, score: top.score };
            throw new Error(`Near-duplicate: ${pct(top.score)} similar to #${top.p.id} "${top.p.title}" (${collegeName(top.p.college)}). Registration paused.`);
          }
          return `Related: ${pct(top.score)} similar to #${top.p.id}, below the ${pct(C.NEAR_DUP)} near-duplicate threshold.`;
        },
      },
      {
        title: "Protect the team's identity (salted hash of roll numbers)",
        run: async () => {
          salt = C.randomSalt();
          tHash = await C.teamHash(salt, members.map((m) => m.roll));
          return `teamHash ${UI.short(tHash, 8)} · on-chain only the initials ${C.teamDisplay(members)} · names, roll numbers and the salt stay with the college`;
        },
      },
      {
        title: "Sign and send registerProject (counts as this college's endorsement)",
        run: async () => {
          const args = [[title, form.domain, year, C.teamDisplay(members), (form.guide || "").trim()], reportHash, fpHex, tHash, declareSimilar || 0];
          const r = await Chain.send(collegeAddr, "registerProject", args);
          id = Number(r.events.find((e) => e.name === "ProjectRegistered").args.id);
          saveReport(reportHash, text); // the college keeps the full report off-chain
          saveTeam(id, { salt, members });
          return `Project #${id} · block #${r.block.number} · tx ${UI.short(r.receipt.hash, 6)} · endorsements 1 of ${data.threshold}`;
        },
      },
    ]);
    s.regResult = { college: collegeAddr, items: run.items, warn, projectId: id || null, ok: run.ok };
    if (!run.ok) {
      if (warn) {
        UI.toast(`Near-duplicate found (${pct(warn.score)} similar to #${warn.id}). Compare the reports before deciding.`, "info", 6000);
        return null;
      }
      throw run.error;
    }
    UI.toast(`Project #${id} registered. It needs ${data.threshold - 1} more endorsement${data.threshold - 1 === 1 ? "" : "s"} from other colleges.`, "success");
    return id;
  }

  async function endorseProject(collegeAddr, id) {
    const r = await Chain.send(collegeAddr, "endorseProject", [id]);
    const ev = r.events.find((e) => e.name === "ProjectEndorsed");
    const verified = r.events.some((e) => e.name === "ProjectVerified");
    UI.toast(
      verified
        ? `Project #${id} is now VERIFIED (${ev.args.endorsements} of ${ev.args.required} endorsements)`
        : `Endorsed project #${id} (${ev.args.endorsements} of ${ev.args.required} endorsements)`,
      "success"
    );
  }

  async function flagProject(collegeAddr, id, similarToId, reason) {
    await Chain.send(collegeAddr, "flagProject", [id, similarToId, reason]);
    UI.toast(`Project #${id} flagged. It is disputed until the board rules.`, "success");
  }

  async function resolveDispute(id, upheld, note) {
    await Chain.send(board(), "resolveDispute", [id, upheld, note]);
    UI.toast(upheld ? `Dispute upheld: project #${id} is rejected` : `Dispute dismissed: project #${id} restored`, "success");
  }

  async function revokeProject(collegeAddr, id, reason) {
    await Chain.send(collegeAddr, "revokeProject", [id, reason]);
    UI.toast(`Project #${id} revoked`, "success");
  }

  /** Public verification of a report text: hash -> exact lookup -> similarity scan. */
  async function verifyReport(text, data) {
    const s = Shell.state;
    const report = C.normalizeReport(text);
    if (!report) throw new Error("Paste or upload a report first.");
    let hash, id = 0, closest = null;
    const host = document.getElementById("v-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Hash the report (SHA-256)",
        run: async () => {
          hash = await C.reportHash(report);
          return hash;
        },
      },
      {
        title: "Look up the exact hash on the blockchain (findByReportHash)",
        run: async () => {
          id = Number(await Chain.contract.findByReportHash(hash));
          return id ? `Found: project #${id} "${data.project(id).title}"` : "No project with this exact report. It was changed, or never registered.";
        },
      },
      {
        title: "Compare its MinHash fingerprint with every project on the ledger",
        run: async () => {
          const sig = C.minhash(report).sig;
          const top = scan(sig, data)[0];
          closest = top && top.score >= C.RELATED ? { id: top.p.id, score: top.score } : null;
          if (!top) return "The ledger is empty.";
          if (id) return `Fingerprint matches #${id} (${pct(C.similarity(sig, data.project(id).sig).score)} of slots equal).`;
          return closest
            ? `Closest: #${top.p.id} "${top.p.title}" (${collegeName(top.p.college)}), ${pct(top.score)} similar${top.score >= C.NEAR_DUP ? ": a near-duplicate" : ""}.`
            : `No similar project (highest ${pct(top.score)}).`;
        },
      },
    ]);
    s.verify = { mode: "report", id: id || null, items: run.items, closest, hash };
    if (!run.ok) throw run.error;
    if (id) UI.toast(`Exact match: project #${id}`, "success");
    else UI.toast(closest ? `No exact match, but ${pct(closest.score)} similar to #${closest.id}` : "No matching project on the ledger", closest ? "error" : "info", 6000);
    return s.verify;
  }

  async function checkTeam(p, saltText, rollsText) {
    const rolls = String(rollsText || "").split(/[\n,;]+/).map((r) => r.trim()).filter(Boolean);
    if (!rolls.length || !String(saltText || "").trim()) throw new Error("Enter the roll numbers and the salt from the verification pack.");
    const h = await C.teamHash(String(saltText).trim(), rolls);
    return { id: p.id, ok: h === p.teamHash, computed: h, count: rolls.length };
  }

  // ------------------------------------------------------------------
  // Shared HTML pieces
  // ------------------------------------------------------------------
  const pageHead = (title, sub, actions = "") =>
    `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row">${actions}</div></div>`;

  function tabs(list, current, attr) {
    return `<div class="segmented tabs" role="tablist">${list
      .map(
        (m) =>
          `<button type="button" role="tab" aria-selected="${sameAddr(m.address, current)}" data-${attr}="${m.address}" class="${sameAddr(m.address, current) ? "active" : ""}" title="${esc(m.name)}">${esc(m.name)}</button>`
      )
      .join("")}</div>`;
  }

  function slotsGrid(matches) {
    return `<div class="slots" aria-label="${matches.filter(Boolean).length} of 32 MinHash slots equal">${matches
      .map((m, i) => `<span class="slot ${m ? "slot-on" : ""}" title="h${i + 1}: ${m ? "equal" : "different"}"></span>`)
      .join("")}</div>
      <div class="legend"><span><span class="slot slot-on mini"></span> equal slot</span><span><span class="slot mini"></span> different slot</span></div>`;
  }

  const docOfProject = (p) => ({ label: `#${p.id} ${p.title}`, sub: `${collegeName(p.college)} · ${p.year}`, text: reportTextOf(p), sig: p.sig, id: p.id });
  const docOfText = (label, sub, text) => {
    const t = C.normalizeReport(text);
    return { label, sub, text: t, sig: C.minhash(t).sig };
  };

  const clip = (text, words) => {
    const w = text.split(" ");
    return w.length > words ? w.slice(0, words).join(" ") + " …" : text;
  };

  /** Side-by-side comparison of two reports (fingerprints always, texts when available). */
  function compareHtml(A, B) {
    const sim = C.similarity(A.sig, B.sig);
    const ov = A.text && B.text ? C.overlap(A.text, B.text) : null;
    const missing = [A, B].filter((d) => !d.text).map((d) => esc(d.label));
    return `<div class="compare">
      <div class="compare-score">
        <div><div class="muted small">MinHash estimate (on-chain fingerprints)</div><div class="big-score">${pct(sim.score)}</div>
          <div class="small muted">${sim.matches.filter(Boolean).length} of 32 slots equal · near-duplicate from ${pct(C.NEAR_DUP)}</div></div>
        ${
          ov
            ? `<div><div class="muted small">Exact Jaccard (3-word shingles)</div><div class="big-score">${pct(ov.jaccard)}</div>
               <div class="small muted">${ov.shared} shared shingles · shared passages cover ${pct(ov.coverageA)} / ${pct(ov.coverageB)} of the texts</div></div>`
            : ""
        }
        <div>${simChip(sim.score)}</div>
      </div>
      ${slotsGrid(sim.matches)}
      ${
        ov
          ? `<div class="side-by-side">
               <div class="pane"><div class="pane-head"><strong>A · ${esc(A.label)}</strong><span class="muted small">${esc(A.sub)}</span></div><div class="pane-text">${ov.htmlA}</div></div>
               <div class="pane"><div class="pane-head"><strong>B · ${esc(B.label)}</strong><span class="muted small">${esc(B.sub)}</span></div><div class="pane-text">${ov.htmlB}</div></div>
             </div>
             <h3 class="sub">Longest shared passages</h3>
             ${
               ov.passages.length
                 ? `<ol class="passages">${ov.passages
                     .slice(0, 5)
                     .map((p) => `<li><span>“${esc(clip(p.text, 45))}”</span> <span class="muted small">${p.words} words</span></li>`)
                     .join("")}</ol>`
                 : `<p class="muted small">No shared 3-word passages.</p>`
             }`
          : `<p class="muted small" style="margin-top:10px">The full text of ${missing.join(" and ")} is not stored in this browser: reports stay with their college. Only the on-chain fingerprints were compared.</p>`
      }
    </div>`;
  }

  function projectsTable(data, list, { actions, compact } = {}) {
    if (!list.length) return `<div class="empty">No projects yet.</div>`;
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Project</th>${compact ? "" : "<th>College</th>"}<th>Status</th><th>Endorsements</th>${actions ? "<th></th>" : ""}</tr></thead>
      <tbody>${list
        .map(
          (p) => `<tr>
          <td data-label="Project"><strong>#${p.id} ${esc(p.title)}</strong><div class="muted small">${esc(p.domain)} · ${p.year}${compact ? ` · ${esc(collegeCode(data, p.college))}` : ""}${
            p.similarToId ? ` · declared similar to #${p.similarToId}` : ""
          }</div></td>
          ${compact ? "" : `<td data-label="College">${esc(collegeName(p.college))}</td>`}
          <td data-label="Status">${statusChip(p)}</td>
          <td data-label="Endorsed">${meter(p)}</td>
          ${actions ? `<td data-label="">${actions(p)}</td>` : ""}
        </tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  // ---------- certificate ----------
  function qrSvg(text) {
    if (!window.QRJS) return "";
    try {
      const q = window.QRJS(text, { errorCorrectLevel: window.QRJS.ErrorCorrectLevel.Q });
      const n = q.getModuleCount();
      let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules[r][c]) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      return `<svg class="qr" viewBox="0 0 ${n + 8} ${n + 8}" role="img" aria-label="QR code that opens this verification page" shape-rendering="crispEdges"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    } catch (e) {
      return "";
    }
  }

  function certificateInner(p, data) {
    const col = data.college(p.college) || { name: collegeName(p.college), code: "?" };
    const url = verifyUrl(p.id);
    const icon = Shell.icon("school");
    return `
      <div class="cert-top"><span class="cert-brand">${icon} ProjectLedger · Inter-College Project Consortium</span><span class="cert-no">Record #${p.id}</span></div>
      <h2 class="cert-title">Project Verification Certificate</h2>
      <p class="cert-lead">The final-year project below is recorded on the consortium blockchain and has been endorsed by
        <strong>${p.endorsers.length} member colleges</strong>; its endorsement policy required <strong>${p.required}</strong>.</p>
      <div class="cert-project">${esc(p.title)}</div>
      <div class="cert-body">
        <dl class="cert-grid">
          <dt>College</dt><dd>${esc(col.name)} (${esc(col.code)})</dd>
          <dt>Academic year</dt><dd>${p.year}</dd>
          <dt>Domain</dt><dd>${esc(p.domain)}</dd>
          <dt>Project guide</dt><dd>${esc(p.guide || "-")}</dd>
          <dt>Team</dt><dd>${esc(p.teamDisplay)} <span class="cert-note">(initials; identities are confirmed with the team hash)</span></dd>
          <dt>Endorsed by</dt><dd>${p.endorsers.map((a) => esc(collegeName(a))).join(", ")}</dd>
          <dt>Registered</dt><dd>${UI.fmtTime(p.registeredAt)}</dd>
          <dt>Verified</dt><dd>${UI.fmtTime(p.verifiedAt)}</dd>
          <dt>Report SHA-256</dt><dd><code class="wrap">${p.reportHash}</code></dd>
          <dt>Team hash</dt><dd><code class="wrap">${p.teamHash}</code></dd>
          <dt>Ledger</dt><dd>contract <code class="wrap">${esc(Chain.address)}</code> · chain id ${Chain.chainId}</dd>
        </dl>
        <div class="cert-qr">${qrSvg(url)}<div class="cert-note">Scan to check this record live</div></div>
      </div>
      <div class="cert-foot">Generated ${UI.fmtTime(Chain.now())} from the blockchain record. To check a report file, hash it with SHA-256 and compare it with the value above, or open <span class="cert-url">${esc(url)}</span></div>`;
  }

  const CERT_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#151a26;background:#fff;margin:24px}
  .certificate{max-width:860px;margin:auto;border:3px double #0369a1;border-radius:12px;padding:28px}
  .cert-top{display:flex;justify-content:space-between;gap:12px;color:#0369a1;font-weight:700;font-size:14px}
  .cert-brand{display:inline-flex;align-items:center;gap:8px}.cert-brand svg{width:20px;height:20px}
  .cert-title{text-align:center;font-size:28px;margin:18px 0 6px}.cert-lead{text-align:center;color:#3b4252;margin:0 0 12px}
  .cert-project{text-align:center;font-size:20px;font-weight:700;margin:6px 0 18px}
  .cert-body{display:flex;gap:24px;align-items:flex-start}.cert-grid{flex:1;display:grid;grid-template-columns:150px 1fr;gap:6px 12px;margin:0;font-size:14px}
  .cert-grid dt{color:#5b6375}.cert-grid dd{margin:0}code{font-family:Consolas,monospace;font-size:12px;word-break:break-all}
  .cert-qr{width:150px;text-align:center}.qr{width:150px;height:150px}.cert-note{font-size:11px;color:#5b6375}
  .cert-foot{margin-top:18px;padding-top:10px;border-top:1px solid #e2e5ee;font-size:12px;color:#5b6375}.cert-url{word-break:break-all}`;

  function certificateDoc(p, data) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Project Verification Certificate #${p.id}</title><style>${CERT_CSS}</style></head>
<body><div class="certificate">${certificateInner(p, data)}</div></body></html>`;
  }

  function printCertificate() {
    const cert = document.querySelector("#certificate");
    if (!cert) return;
    let root = document.getElementById("print-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "print-root";
      document.body.appendChild(root);
    }
    root.innerHTML = cert.outerHTML;
    document.body.classList.add("print-cert");
    const done = () => {
      document.body.classList.remove("print-cert");
      root.innerHTML = "";
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  function packText(p, data, team) {
    return [
      "ProjectLedger verification pack",
      "",
      `Project #${p.id}: ${p.title}`,
      `College: ${collegeName(p.college)} (${collegeCode(data, p.college)}), ${p.year}`,
      `Verify online: ${verifyUrl(p.id)}`,
      "",
      "Team (name, roll number) - share only with the verifier:",
      ...team.members.map((m) => `  ${m.name}, ${m.roll}`),
      `Salt: ${team.salt}`,
      `Roll numbers: ${team.members.map((m) => m.roll).join(", ")}`,
      "",
      `On-chain team hash: ${p.teamHash}`,
      `teamHash = SHA-256( salt | roll numbers sorted, joined by "," )`,
      "",
    ].join("\n");
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  async function viewHome(el, { data, go }) {
    const ps = data.projects;
    const verified = ps.filter((p) => p.status === ST.Verified).length;
    const waiting = ps.filter((p) => p.status === ST.Pending).length;
    const flagged = ps.filter((p) => p.status === ST.Disputed || p.status === ST.Rejected).length;
    el.innerHTML = `
      ${pageHead(
        "ProjectLedger: Inter-College Project Verification",
        "Final-year project records sit in isolated college databases, so employers cannot check them and the same report is re-submitted at another college unnoticed. ProjectLedger puts every project on a consortium blockchain shared by the colleges: a record is verified only when K of N colleges endorse it, and each new report is scanned for near-duplicates across all colleges.",
        `<button class="btn" id="start-btn">${Shell.icon("school")} Register a project</button>
         <button class="btn btn-secondary" id="verify-btn">${Shell.icon("shield")} Verify a project</button>`
      )}
      <div class="grid-4" style="margin-bottom:16px">
        <div class="card stat"><span class="stat-value">${ps.length}</span><span class="stat-label">Projects on the ledger</span></div>
        <div class="card stat"><span class="stat-value">${verified}</span><span class="stat-label">Verified (policy now ${data.threshold} of ${data.activeColleges})</span></div>
        <div class="card stat"><span class="stat-value">${waiting}</span><span class="stat-label">Awaiting endorsements</span></div>
        <div class="card stat"><span class="stat-value">${flagged}</span><span class="stat-label">Flagged as duplicates</span></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>How it works</h2></div>
        <div class="flow" style="--steps:4">
          <div class="flow-step"><h3>Register &amp; fingerprint</h3><p>The college hashes the report (SHA-256) and builds a MinHash fingerprint. Names stay off-chain; only a salted team hash is stored.</p></div>
          <div class="flow-step"><h3>Similarity scan</h3><p>The new fingerprint is compared with every project from every college. Near-duplicates are shown side by side before anything is submitted.</p></div>
          <div class="flow-step"><h3>K-of-N endorsement</h3><p>Other colleges review and endorse. The smart contract marks the record Verified only when the endorsement policy is met, like Hyperledger Fabric.</p></div>
          <div class="flow-step"><h3>Verify &amp; certify</h3><p>Employers look up a project or upload the report. An exact hash match shows the record, its endorsers and a printable certificate.</p></div>
        </div>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card"><div class="card-head"><h2>Recent projects</h2><a href="#/review" class="small">Peer review</a></div>
          ${projectsTable(data, [...ps].reverse().slice(0, 8), { compact: true })}</div>
        <div class="card">
          <div class="card-head"><h2>Demo script (5 minutes)</h2></div>
          <ol class="demo-steps">
            <li><a href="#/college">College</a> → <em>Lakeview Polytechnic</em>: register the sample <em>IoT-Based Automated Farm Irrigation</em>. The scan stops at 63% similar to #1 and shows both reports side by side. Register it anyway, declaring the similarity.</li>
            <li><a href="#/college">College</a> → <em>Northgate</em>: register the ECG monitor (clean scan). Then <em>Hillcrest</em> submits Riverside's report unchanged: the smart contract refuses the exact copy.</li>
            <li><a href="#/review">Peer Review</a> → <em>Riverside</em>: compare #6 with #1 and flag it. Endorse #5 and #7: they become Verified.</li>
            <li><a href="#/board">Consortium Board</a>: try a threshold of 5 (blocked), set 3, then uphold the dispute: #6 is Rejected.</li>
            <li><a href="#/verify">Verify Project</a>: look up #1 and print its certificate; check the copied report: it is Rejected.</li>
            <li><a href="#/review">Peer Review</a>: <em>Skip 31 days</em>, then try to endorse a waiting project: the review window is closed.</li>
            <li><a href="#/explorer">Blockchain Explorer</a>: the hash-linked blocks and the audit log.</li>
          </ol>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Consortium</h2><span class="muted small">Endorsement policy: ${data.threshold} of ${data.activeColleges} active colleges (the registering college counts as one)</span></div>
        <div class="college-grid">${data.colleges
          .map((m) => {
            const mine = ps.filter((p) => sameAddr(p.college, m.address));
            return `<div class="college-tile"><div class="tile-head"><strong>${esc(m.name)}</strong>${memberChip(m)}</div>
              <div class="muted small">${esc(m.code)} · ${mine.length} projects · ${mine.filter((p) => p.status === ST.Verified).length} verified · ${
                ps.filter((p) => p.endorsers.some((a) => sameAddr(a, m.address)) && !sameAddr(p.college, m.address)).length
              } endorsements given</div></div>`;
          })
          .join("")}</div>
      </div>`;
    el.querySelector("#start-btn").addEventListener("click", () => go("college"));
    el.querySelector("#verify-btn").addEventListener("click", () => go("verify"));
  }

  // ---------- College ----------
  function defaultForm(data, collegeAddr) {
    const idx = Chain.accounts.findIndex((a) => sameAddr(a, collegeAddr));
    const onLedger = new Set(data.projects.map((p) => p.reportHash));
    const mine = [...sampleByHash.values()].filter((s) => s.college === idx);
    const pick = mine.find((s) => !onLedger.has(s.hash));
    return pick ? formFromSample(pick) : { college: collegeAddr, sampleKey: "", title: "", domain: S.DOMAINS[0], year: new Date(Chain.now() * 1000).getFullYear(), guide: "", members: "", text: "" };
  }
  function formFromSample(s) {
    return {
      sampleKey: s.key,
      title: s.title,
      domain: s.domain,
      year: s.year,
      guide: s.guide,
      members: s.team.map((m) => `${m.name}, ${m.roll}`).join("\n"),
      text: S.reportText(s), // the full report: title line + body (this is what gets hashed)
    };
  }

  async function viewCollege(el, { data, state, action }) {
    if (!data.colleges.length) return (el.innerHTML = `<div class="empty">No colleges in the consortium yet.</div>`);
    if (!data.colleges.some((c) => sameAddr(c.address, state.college))) state.college = data.colleges[0].address;
    const me = data.college(state.college);
    if (!state.reg || !sameAddr(state.reg.college, me.address)) state.reg = { ...defaultForm(data, me.address), college: me.address };
    const f = state.reg;
    const r = state.regResult && sameAddr(state.regResult.college, me.address) ? state.regResult : null;
    const idx = Chain.accounts.findIndex((a) => sameAddr(a, me.address));
    const samples = [...sampleByHash.values()];
    const sampleOpt = (s) => `<option value="${s.key}" ${s.key === f.sampleKey ? "selected" : ""}>${esc(s.title)}${s.college === idx ? "" : ` (${esc(S.COLLEGES[s.college - 1].code)})`}</option>`;
    const mine = data.projects.filter((p) => sameAddr(p.college, me.address));
    const warnP = r && r.warn ? data.project(r.warn.id) : null;
    const newP = r && r.projectId ? data.project(r.projectId) : null;

    el.innerHTML = `
      ${pageHead("College", `Register your students' final-year projects on the shared ledger. Acting as <strong>${esc(me.name)}</strong> (account <code>${UI.short(me.address, 4)}</code>).`)}
      ${tabs(data.colleges, me.address, "college")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="reg-form" autocomplete="off">
          <div class="card-head"><h2>Register a project</h2><span class="muted small">${esc(me.code)} ${memberChip(me)}</span></div>
          <div class="field"><label for="reg-sample">Start from a built-in sample report</label>
            <div class="row nowrap-row"><select id="reg-sample"><option value="">Blank form</option>
              <optgroup label="This college's samples">${samples.filter((s) => s.college === idx).map(sampleOpt).join("")}</optgroup>
              <optgroup label="Other colleges' samples (to test duplicate checks)">${samples.filter((s) => s.college !== idx).map(sampleOpt).join("")}</optgroup>
            </select>
            <label class="btn btn-secondary btn-sm">${Shell.icon("upload")} Upload .txt / .md<input type="file" id="reg-upload" accept=".txt,.md,text/plain,text/markdown" hidden></label></div></div>
          <div class="field"><label for="reg-title">Project title</label><input id="reg-title" type="text" required value="${esc(f.title)}"></div>
          <div class="grid-3 tight">
            <div class="field"><label for="reg-domain">Domain</label><select id="reg-domain">${S.DOMAINS.map((d) => `<option ${d === f.domain ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
            <div class="field"><label for="reg-year">Year</label><input id="reg-year" type="number" min="2000" max="2100" value="${esc(f.year)}"></div>
            <div class="field"><label for="reg-guide">Project guide</label><input id="reg-guide" type="text" value="${esc(f.guide)}"></div>
          </div>
          <div class="field"><label for="reg-members">Team: one student per line, "Name, Roll number"</label>
            <textarea id="reg-members" rows="3" class="short">${esc(f.members)}</textarea>
            <span class="hint">Stays with the college. Only initials and SHA-256(salt | roll numbers) go on-chain.</span></div>
          <div class="field"><label for="reg-text">Project report</label><textarea id="reg-text" rows="9">${esc(f.text)}</textarea>
            <span class="hint">Only its SHA-256 hash and a 128-byte MinHash fingerprint go on-chain.</span></div>
          <button class="btn" type="submit" id="reg-btn">${Shell.icon("layers")} Hash, fingerprint &amp; register</button>
        </form>
        <div class="card">
          <div class="card-head"><h2>What happens</h2></div>
          <div id="reg-steps">${
            r
              ? UI.checklist(r.items)
              : `<p class="muted">Five steps run in your browser and are shown here: the SHA-256 report hash, the MinHash fingerprint, the similarity scan against every college's projects, the salted team hash and the signed transaction.</p>`
          }</div>
          ${
            warnP
              ? `<div class="callout callout-warn" style="margin-top:14px"><strong>Possible duplicate.</strong> This report is ${pct(r.warn.score)} similar to
                 #${warnP.id} "${esc(warnP.title)}" by ${esc(collegeName(warnP.college))} (${warnP.year}). The comparison is shown below.
                 If this is a genuine extension, register it and declare the similarity on-chain; other colleges will see it during review.
                 <div class="row" style="margin-top:10px"><button type="button" class="btn btn-sm" id="declare-btn">Register anyway, declaring similarity to #${warnP.id}</button></div></div>`
              : ""
          }
          ${
            newP
              ? `<div class="callout callout-ok" style="margin-top:14px"><strong>Project #${newP.id} is on the ledger.</strong> Status: ${statusChip(newP)} ${meter(newP)}.
                 Other colleges can now endorse it in <a href="#/review">Peer Review</a>.</div>`
              : ""
          }
        </div>
      </div>
      ${
        warnP
          ? `<div class="card" style="margin-bottom:16px" id="reg-compare"><div class="card-head"><h2>Your report vs #${warnP.id}</h2><span class="muted small">Highlighted: 3-word passages that appear in both reports</span></div>
             ${compareHtml(docOfText("Your report", `${me.name} · not registered`, f.text), docOfProject(warnP))}</div>`
          : ""
      }
      <div class="card">
        <div class="card-head"><h2>${esc(me.name)}: projects on the ledger</h2><span class="muted small">${mine.length} records</span></div>
        ${projectsTable(data, mine, {
          compact: true,
          actions: (p) => `<div class="row">
            <a class="btn btn-secondary btn-sm" href="#/verify?id=${p.id}">Record</a>
            ${reportTextOf(p) ? `<button type="button" class="btn btn-ghost btn-sm" data-report="${p.id}">Report .txt</button>` : ""}
            ${teamRecordOf(p) ? `<button type="button" class="btn btn-ghost btn-sm" data-pack="${p.id}">Verification pack</button>` : ""}
            ${p.stored === ST.Pending || p.stored === ST.Verified ? `<button type="button" class="btn btn-ghost btn-sm" data-revoke="${p.id}">Revoke</button>` : ""}
          </div>`,
        })}
      </div>`;

    el.querySelectorAll("[data-college]").forEach((b) =>
      b.addEventListener("click", () => {
        state.college = b.dataset.college;
        Shell.render();
      })
    );
    const form = el.querySelector("#reg-form");
    const bind = (id, key) => el.querySelector(id).addEventListener("input", (e) => (f[key] = e.target.value));
    bind("#reg-title", "title");
    bind("#reg-year", "year");
    bind("#reg-guide", "guide");
    bind("#reg-members", "members");
    bind("#reg-text", "text");
    el.querySelector("#reg-domain").addEventListener("change", (e) => (f.domain = e.target.value));
    el.querySelector("#reg-sample").addEventListener("change", (e) => {
      const s = S.sample(e.target.value);
      state.reg = s ? { ...formFromSample({ ...s, team: s.members.map(([name, roll]) => ({ name, roll })) }), college: me.address } : { ...f, sampleKey: "" };
      state.regResult = null;
      Shell.render();
    });
    el.querySelector("#reg-upload").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > C.MAX_TEXT) return UI.toast("Reports up to 200 KB of text only.", "error");
      const text = C.normalizeReport(await UI.readFileText(file));
      const first = (text.split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim();
      Object.assign(f, { sampleKey: "", text, title: f.title && f.sampleKey === "" ? f.title : first.slice(0, 120) });
      state.regResult = null;
      UI.toast(`Loaded ${file.name} (${C.analyse(text).words} words)`, "success", 2500);
      Shell.render();
    });
    const submit = (declareSimilar) => {
      const problem = formProblem({ ...f, title: form.querySelector("#reg-title").value });
      if (problem) return UI.toast(problem, "error");
      return action(el.querySelector(declareSimilar ? "#declare-btn" : "#reg-btn"), async () => {
        state.regResult = null;
        const id = await registerProject(me.address, { ...f, title: form.querySelector("#reg-title").value }, data, { declareSimilar });
        if (id) state.reg = { ...defaultForm(await load(), me.address), college: me.address };
      });
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(0);
    });
    const db = el.querySelector("#declare-btn");
    if (db) db.addEventListener("click", () => submit(r.warn.id));
    el.querySelectorAll("[data-report]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = data.project(b.dataset.report);
        UI.download(`project-${p.id}-report.txt`, reportTextOf(p) + "\n");
      })
    );
    el.querySelectorAll("[data-pack]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = data.project(b.dataset.pack);
        UI.download(`project-${p.id}-verification-pack.txt`, packText(p, data, teamRecordOf(p)));
      })
    );
    el.querySelectorAll("[data-revoke]").forEach((b) =>
      b.addEventListener("click", () => {
        const reason = prompt(`Reason for revoking project #${b.dataset.revoke}:`, "Submitted with wrong details; will be registered again");
        if (reason) action(b, () => revokeProject(me.address, Number(b.dataset.revoke), reason));
      })
    );
  }

  // ---------- Peer review ----------
  async function viewReview(el, { data, state, action }) {
    if (!data.colleges.length) return (el.innerHTML = `<div class="empty">No colleges in the consortium yet.</div>`);
    if (!data.colleges.some((c) => sameAddr(c.address, state.reviewer))) state.reviewer = data.colleges[0].address;
    const me = data.college(state.reviewer);
    const others = data.projects.filter((p) => !sameAddr(p.college, me.address));
    const toReview = others.filter((p) => (p.status === ST.Pending || p.status === ST.Expired) && !p.endorsers.some((a) => sameAddr(a, me.address)));
    const flaggable = others.filter((p) => p.status === ST.Verified || ((p.status === ST.Pending || p.status === ST.Expired) && !toReview.includes(p)));
    const disputed = others.filter((p) => p.status === ST.Disputed);
    const cmp = state.compare && data.project(state.compare.a) && data.project(state.compare.b) ? state.compare : null;

    const flagForm = (p, top) => {
      const defReason =
        top && top.score >= C.RELATED
          ? `Near-duplicate of project #${top.p.id} "${top.p.title}" (${collegeName(top.p.college)}): ${pct(top.score)} MinHash similarity; same design and results with light rewording.`
          : "";
      return `<form class="flag-form" data-flagform="${p.id}">
        <div class="muted small" style="margin-bottom:8px">Flag <strong>#${p.id} ${esc(p.title)}</strong> as a suspected duplicate. It becomes <em>Disputed</em> until the board rules.</div>
        <div class="field"><label for="flag-ref-${p.id}">Appears to copy</label><select id="flag-ref-${p.id}">
          <option value="0">An outside source (not on the ledger)</option>
          ${data.projects
            .filter((q) => q.id !== p.id)
            .map((q) => `<option value="${q.id}" ${top && top.score >= C.RELATED && top.p.id === q.id ? "selected" : ""}>#${q.id} ${esc(q.title)} (${esc(collegeCode(data, q.college))})</option>`)
            .join("")}
        </select></div>
        <div class="field"><label for="flag-reason-${p.id}">Reason (recorded on-chain)</label><textarea id="flag-reason-${p.id}" class="short" rows="3">${esc(defReason)}</textarea></div>
        <div class="row"><button type="submit" class="btn btn-danger" data-flag="${p.id}">Flag for the board</button><button type="button" class="btn btn-ghost" data-flagcancel="1">Cancel</button></div>
      </form>`;
    };

    const card = (p) => {
      const top = scan(p.sig, data, p.id)[0];
      const expired = p.status === ST.Expired;
      const flagOpen = state.flagFor === p.id;
      return `<div class="card review-card" data-card="${p.id}">
        <div class="card-head"><div><h2>#${p.id} ${esc(p.title)}</h2><div class="muted small">${esc(collegeName(p.college))} · ${p.year} · ${esc(p.domain)}</div></div>${statusChip(p)}</div>
        <div class="kv"><span>Guide · team</span><span>${esc(p.guide || "-")} · ${esc(p.teamDisplay)}</span></div>
        <div class="kv"><span>Report SHA-256</span><code title="${p.reportHash}">${UI.short(p.reportHash, 8)}</code></div>
        <div class="kv"><span>Endorsements</span><span>${meter(p)} <span class="muted small">by ${p.endorsers.map((a) => esc(collegeCode(data, a))).join(", ")}</span></span></div>
        <div class="kv"><span>Review window</span><span>${
          expired ? `closed on ${UI.fmtTime(p.reviewDeadline)}` : `closes in <strong data-countdown="${p.reviewDeadline}" data-done-text="now">${UI.fmtDuration(p.reviewDeadline - Chain.now())}</strong>`
        }</span></div>
        <div class="kv"><span>Declared similar to</span><span>${p.similarToId ? `#${p.similarToId} (declared by the college)` : "none"}</span></div>
        <div class="kv"><span>Similarity scan</span><span>${
          top && top.score >= C.RELATED
            ? `${simChip(top.score, top.p)} <span class="muted small">${esc(top.p.title)} · ${esc(collegeName(top.p.college))}</span>`
            : `<span class="chip chip-ok">no near-duplicates</span> <span class="muted small">highest ${pct(top ? top.score : 0)} across ${data.projects.length - 1} projects</span>`
        }</span></div>
        <div class="row" style="margin-top:10px">
          <button type="button" class="btn ${expired ? "btn-secondary" : ""}" data-endorse="${p.id}">${Shell.icon("check")} ${expired ? "Try to endorse (window closed)" : "Endorse"}</button>
          ${top && top.score >= C.RELATED ? `<button type="button" class="btn btn-secondary" data-compare="${p.id}:${top.p.id}">Compare with #${top.p.id}</button>` : ""}
          <button type="button" class="btn btn-ghost" data-flagopen="${p.id}">Flag as duplicate</button>
        </div>
        ${flagOpen ? flagForm(p, top) : ""}
      </div>`;
    };
    const flagLater = state.flagFor && flaggable.find((p) => p.id === state.flagFor);

    el.innerHTML = `
      ${pageHead(
        "Peer Review",
        "Colleges review each other's new projects. Each endorsement is a signed transaction; the smart contract verifies a project once the endorsement policy is met. Every review shows an automatic similarity scan computed from the on-chain fingerprints.",
        `<button type="button" class="btn btn-secondary" id="skip-btn" title="Move blockchain time forward 31 days">${Shell.icon("forward")} Skip 31 days</button>`
      )}
      ${tabs(data.colleges, me.address, "reviewer")}
      <div class="grid-2" style="align-items:start">
        <div class="stack">
          <div class="muted small">Reviewing as <strong>${esc(me.name)}</strong> ${memberChip(me)} · policy ${data.threshold} of ${data.activeColleges} colleges</div>
          ${toReview.length ? toReview.map(card).join("") : `<div class="card empty">Nothing waiting for ${esc(me.name)}'s review.</div>`}
          ${
            disputed.length
              ? `<div class="card"><div class="card-head"><h2>Under dispute</h2><span class="muted small">Waiting for the board</span></div>${projectsTable(data, disputed, { compact: true })}</div>`
              : ""
          }
          <div class="card"><div class="card-head"><h2>Other colleges' projects</h2><span class="muted small">Plagiarism found later can still be flagged</span></div>
            ${projectsTable(data, flaggable, {
              compact: true,
              actions: (p) => {
                const top = scan(p.sig, data, p.id)[0];
                return `<div class="row">${top && top.score >= C.RELATED ? simChip(top.score, top.p) : ""}
                  ${top && top.score >= C.RELATED ? `<button type="button" class="btn btn-secondary btn-sm" data-compare="${p.id}:${top.p.id}">Compare</button>` : ""}
                  <button type="button" class="btn btn-ghost btn-sm" data-flagopen="${p.id}">Flag</button></div>`;
              },
            })}
            ${flagLater ? `<div class="flag-later">${flagForm(flagLater, scan(flagLater.sig, data, flagLater.id)[0])}</div>` : ""}
          </div>
        </div>
        <div class="card compare-card" id="compare-card">
          <div class="card-head"><h2>Side-by-side comparison</h2>${cmp ? `<span class="muted small">#${cmp.a} vs #${cmp.b}</span>` : ""}</div>
          ${
            cmp
              ? compareHtml(docOfProject(data.project(cmp.a)), docOfProject(data.project(cmp.b)))
              : `<p class="muted">Click <em>Compare</em> on a project to see its MinHash slots, the exact overlap and the shared passages highlighted in both reports.</p>`
          }
        </div>
      </div>`;

    el.querySelectorAll("[data-reviewer]").forEach((b) =>
      b.addEventListener("click", () => {
        state.reviewer = b.dataset.reviewer;
        state.flagFor = null;
        Shell.render();
      })
    );
    el.querySelector("#skip-btn").addEventListener("click", (e) =>
      action(e.currentTarget, async () => {
        await Chain.fastForward(31 * DAY);
        UI.toast("Blockchain time moved forward 31 days: open review windows have closed", "success");
      })
    );
    el.querySelectorAll("[data-endorse]").forEach((b) => b.addEventListener("click", () => action(b, () => endorseProject(me.address, Number(b.dataset.endorse)))));
    el.querySelectorAll("[data-compare]").forEach((b) =>
      b.addEventListener("click", () => {
        const [a, c] = b.dataset.compare.split(":").map(Number);
        state.compare = { a, b: c };
        Shell.render().then(() => {
          const cc = document.getElementById("compare-card");
          if (cc && window.innerWidth < 860) cc.scrollIntoView({ block: "start" });
        });
      })
    );
    el.querySelectorAll("[data-flagopen]").forEach((b) =>
      b.addEventListener("click", () => {
        state.flagFor = Number(b.dataset.flagopen);
        Shell.render();
      })
    );
    el.querySelectorAll("[data-flagcancel]").forEach((b) =>
      b.addEventListener("click", () => {
        state.flagFor = null;
        Shell.render();
      })
    );
    el.querySelectorAll("[data-flagform]").forEach((fm) =>
      fm.addEventListener("submit", (e) => {
        e.preventDefault();
        const id = Number(fm.dataset.flagform);
        const ref = Number(fm.querySelector(`#flag-ref-${id}`).value);
        const reason = fm.querySelector(`#flag-reason-${id}`).value.trim();
        action(fm.querySelector("[data-flag]"), async () => {
          await flagProject(me.address, id, ref, reason);
          state.flagFor = null;
        });
      })
    );
  }

  // ---------- Board ----------
  async function viewBoard(el, { data, state, action }) {
    const free = Chain.accounts.map((a, i) => ({ a, i })).filter(({ a, i }) => i > 0 && !data.colleges.some((m) => sameAddr(m.address, a)));
    const disputed = data.projects.filter((p) => p.status === ST.Disputed);
    const resolved = data.projects.filter((p) => p.flags.length && p.status !== ST.Disputed);
    const cmp = state.boardCompare && data.project(state.boardCompare.a) && data.project(state.boardCompare.b) ? state.boardCompare : null;

    const disputeHtml = (p) => {
      const last = p.flags[p.flags.length - 1];
      const ref = last && last.similarToId ? data.project(last.similarToId) : null;
      const sim = ref ? C.similarity(p.sig, ref.sig).score : null;
      return `<div class="dispute">
        <div class="card-head"><div><h3>#${p.id} ${esc(p.title)}</h3><div class="muted small">${esc(collegeName(p.college))} · ${p.year} · ${p.endorsements} of ${p.required} endorsements</div></div>${statusChip(p)}</div>
        ${p.flags
          .map(
            (f) => `<div class="kv"><span>Flagged by</span><span><strong>${esc(collegeName(f.college))}</strong>${f.similarToId ? ` · similar to #${f.similarToId}` : " · outside source"} · ${UI.fmtTime(f.time)}<br><span class="muted small">${esc(f.reason)}</span></span></div>`
          )
          .join("")}
        ${ref ? `<div class="kv"><span>Fingerprints</span><span>${simChip(sim, ref)} <button type="button" class="btn btn-secondary btn-sm" data-bcompare="${p.id}:${ref.id}">Compare reports</button></span></div>` : ""}
        <div class="field" style="margin-top:8px"><label for="note-${p.id}">Ruling note (recorded on-chain)</label>
          <input type="text" id="note-${p.id}" value="${esc(ref ? `Plagiarism confirmed: the report copies #${ref.id} with light rewording.` : "Copied from an outside source.")}"></div>
        <div class="row"><button type="button" class="btn btn-danger" data-uphold="${p.id}">Uphold: reject #${p.id}</button>
          <button type="button" class="btn btn-secondary" data-dismiss="${p.id}">Dismiss: restore #${p.id}</button></div>
      </div>`;
    };

    el.innerHTML = `
      ${pageHead(
        "Consortium Board",
        `The University Consortium Board (account <code>${UI.short(board(), 4)}</code>, the contract deployer) admits colleges, sets the endorsement policy and rules on disputes. It cannot register or endorse projects itself.`
      )}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Endorsement policy</h2></div>
            <div class="policy"><span class="policy-k">${data.threshold}</span><span class="muted">of</span><span class="policy-n">${data.activeColleges}</span><span class="muted small">active colleges must endorse a project (the registering college counts as one)</span></div>
            <div class="row nowrap-row" style="margin-top:12px"><label for="k-input" class="small" style="font-weight:600">New threshold K</label>
              <input id="k-input" type="number" min="2" step="1" value="${data.threshold}" style="max-width:110px">
              <button type="button" class="btn" id="k-btn">Update policy</button></div>
            <p class="muted small" style="margin:10px 0 0">Applies to projects registered from now on. Each project keeps the policy in force when it was submitted, like a Fabric endorsement policy fixed for a chaincode version.</p>
          </div>
          <form class="card" id="college-form" autocomplete="off">
            <div class="card-head"><h2>Admit a college</h2></div>
            ${
              free.length
                ? `<div class="field"><label for="col-account">Account</label><select id="col-account">${free.map(({ a, i }) => `<option value="${a}">Account #${i} · ${UI.short(a, 4)}</option>`).join("")}</select></div>
                   <div class="grid-2 tight"><div class="field"><label for="col-name">College name</label><input id="col-name" type="text" placeholder="e.g. Westbrook College of Science"></div>
                   <div class="field"><label for="col-code">Code</label><input id="col-code" type="text" placeholder="WCS" maxlength="8"></div></div>
                   <button class="btn" type="submit" id="col-btn">${Shell.icon("users")} Admit college</button>`
                : `<p class="muted">All demo accounts are already colleges.</p>`
            }
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>Open disputes</h2><span class="muted small">${disputed.length} open</span></div>
          ${disputed.length ? disputed.map(disputeHtml).join("") : `<p class="muted">No open disputes. Colleges raise them from Peer Review with <em>Flag as duplicate</em>.</p>`}
          ${
            resolved.length
              ? `<h3 class="sub">Resolved</h3><div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th>Outcome</th><th>Ruling</th></tr></thead><tbody>${resolved
                  .map(
                    (p) => `<tr><td data-label="Project"><strong>#${p.id}</strong> ${esc(p.title)}</td><td data-label="Outcome">${statusChip(p)}</td><td data-label="Ruling">${esc(p.note || "-")}</td></tr>`
                  )
                  .join("")}</tbody></table></div>`
              : ""
          }
        </div>
      </div>
      ${
        cmp
          ? `<div class="card" style="margin-bottom:16px" id="board-compare"><div class="card-head"><h2>Dispute evidence: #${cmp.a} vs #${cmp.b}</h2></div>${compareHtml(
              docOfProject(data.project(cmp.a)),
              docOfProject(data.project(cmp.b))
            )}</div>`
          : ""
      }
      <div class="card">
        <div class="card-head"><h2>Member colleges</h2><span class="muted small">Permissioned: only the board admits or suspends colleges</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>College</th><th>Code</th><th>Account</th><th>Projects</th><th>Status</th><th></th></tr></thead><tbody>
        ${data.colleges
          .map(
            (m) => `<tr><td data-label="College"><strong>${esc(m.name)}</strong></td><td data-label="Code">${esc(m.code)}</td>
            <td data-label="Account"><code>${UI.short(m.address, 4)}</code></td>
            <td data-label="Projects">${data.projects.filter((p) => sameAddr(p.college, m.address)).length}</td>
            <td data-label="Status">${memberChip(m)}</td>
            <td data-label=""><button type="button" class="btn btn-secondary btn-sm" data-toggle="${m.address}" data-active="${m.active}">${m.active ? "Suspend" : "Re-activate"}</button></td></tr>`
          )
          .join("")}</tbody></table></div>
      </div>`;

    el.querySelector("#k-btn").addEventListener("click", (e) => {
      const k = Number(el.querySelector("#k-input").value);
      if (!Number.isInteger(k) || k < 0 || k > 255) return UI.toast("Enter a whole number for the threshold.", "error");
      action(e.currentTarget, async () => {
        await Chain.send(board(), "setThreshold", [k]);
        UI.toast(`Endorsement policy is now ${k} of ${data.activeColleges} colleges`, "success");
      });
    });
    const cf = el.querySelector("#college-form");
    cf.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!free.length) return;
      const name = el.querySelector("#col-name").value.trim();
      const code = el.querySelector("#col-code").value.trim().toUpperCase();
      action(el.querySelector("#col-btn"), async () => {
        await Chain.send(board(), "addCollege", [el.querySelector("#col-account").value, name, code]);
        UI.toast(`${name} joined the consortium`, "success");
      });
    });
    el.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () =>
        action(b, async () => {
          const on = b.dataset.active !== "true";
          await Chain.send(board(), "setCollegeActive", [b.dataset.toggle, on]);
          UI.toast(`${Chain.label(b.dataset.toggle)} ${on ? "re-activated" : "suspended"}`, "success");
        })
      )
    );
    el.querySelectorAll("[data-bcompare]").forEach((b) =>
      b.addEventListener("click", () => {
        const [a, c] = b.dataset.bcompare.split(":").map(Number);
        state.boardCompare = { a, b: c };
        Shell.render().then(() => {
          const bc = document.getElementById("board-compare");
          if (bc) bc.scrollIntoView({ block: "start" });
        });
      })
    );
    const rule = (b, upheld) => {
      const id = Number(b.dataset.uphold || b.dataset.dismiss);
      const note = el.querySelector(`#note-${id}`).value.trim();
      action(b, () => resolveDispute(id, upheld, note));
    };
    el.querySelectorAll("[data-uphold]").forEach((b) => b.addEventListener("click", () => rule(b, true)));
    el.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", () => rule(b, false)));
  }

  // ---------- Verify (public) ----------
  function recordHtml(p, data) {
    const verdict = {
      [ST.Verified]: `<div class="callout callout-ok verdict"><strong>Verified.</strong> Endorsed by ${p.endorsers.length} colleges (its policy required ${p.required}).</div>`,
      [ST.Pending]: `<div class="callout callout-warn verdict"><strong>Not verified yet.</strong> ${p.endorsements} of ${p.required} endorsements so far; the review window closes ${UI.fmtTime(p.reviewDeadline)}.</div>`,
      [ST.Expired]: `<div class="callout callout-warn verdict"><strong>Not verified.</strong> The review window closed with ${p.endorsements} of ${p.required} endorsements.</div>`,
      [ST.Disputed]: `<div class="callout callout-bad verdict"><strong>Under dispute.</strong> A college flagged this project as a suspected duplicate; the board has not ruled yet.</div>`,
      [ST.Rejected]: `<div class="callout callout-bad verdict"><strong>Rejected by the consortium board.</strong> ${esc(p.note)}</div>`,
      [ST.Revoked]: `<div class="callout callout-bad verdict"><strong>Revoked by its college.</strong> ${esc(p.note)}</div>`,
    }[p.status];
    return `${verdict}
      <div class="kv" style="margin-top:12px"><span>Project</span><strong>#${p.id} ${esc(p.title)}</strong></div>
      <div class="kv"><span>College</span><span>${esc(collegeName(p.college))} · ${p.year} · ${esc(p.domain)}</span></div>
      <div class="kv"><span>Guide · team</span><span>${esc(p.guide || "-")} · ${esc(p.teamDisplay)}</span></div>
      <div class="kv"><span>Endorsed by</span><span>${p.endorsers.map((a) => esc(collegeName(a))).join(", ")}</span></div>
      <div class="kv"><span>Report SHA-256</span><code class="wrap">${p.reportHash}</code></div>
      ${p.similarToId ? `<div class="kv"><span>Declared similar to</span><span>#${p.similarToId}${titleOf(p.similarToId) ? esc(titleOf(p.similarToId)) : ""}</span></div>` : ""}
      ${p.flags
        .map((f) => `<div class="kv"><span>Flag</span><span>${esc(collegeName(f.college))}: ${esc(f.reason)}</span></div>`)
        .join("")}`;
  }

  async function viewVerify(el, { data, state, action }) {
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    const qid = Number(q.get("id") || 0);
    if (qid && state.verifyQueryId !== qid) {
      state.verifyQueryId = qid;
      state.verify = { mode: "id", id: data.project(qid) ? qid : null, notFound: data.project(qid) ? null : qid };
    }
    const v = state.verify || null;
    const p = v && v.id ? data.project(v.id) : null;
    const tc = state.teamCheck && p && state.teamCheck.id === p.id ? state.teamCheck : null;
    if (!state.teamInput || !p || state.teamInput.id !== p.id) state.teamInput = { id: p ? p.id : 0, rolls: "", salt: "" };
    const ti = state.teamInput;
    const vt = state.verifyText || "";
    const samples = [...sampleByHash.values()];

    el.innerHTML = `
      ${pageHead("Verify a Project", "For employers and universities. No account needed: look up a project by its ID, or check a report file against the ledger. Only hashes are compared; nothing is uploaded anywhere.")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2>Look up by project ID</h2></div>
          <form class="row nowrap-row" id="id-form"><label for="v-id" class="sr-only">Project ID</label>
            <input id="v-id" type="number" min="1" placeholder="e.g. 1" value="${v && v.mode === "id" && (v.id || v.notFound) ? v.id || v.notFound : ""}" style="max-width:140px">
            <button class="btn" type="submit" id="v-id-btn">${Shell.icon("search")} Look up</button></form>
          <div class="divider"><span>or check a report</span></div>
          <form id="text-form">
            <div class="row nowrap-row" style="margin-bottom:8px">
              <select id="v-sample" aria-label="Load a built-in sample report"><option value="">Load a built-in sample report…</option>${samples
                .map((s) => `<option value="${s.key}">${esc(s.title)}</option>`)
                .join("")}</select>
              <label class="btn btn-secondary btn-sm">${Shell.icon("upload")} Upload .txt / .md<input type="file" id="v-file" accept=".txt,.md,text/plain,text/markdown" hidden></label>
            </div>
            <div class="field"><label for="v-text" class="sr-only">Report text</label><textarea id="v-text" rows="7" placeholder="Paste the project report here…">${esc(vt)}</textarea></div>
            <button class="btn" type="submit" id="v-text-btn">${Shell.icon("shield")} Check report</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>Result</h2></div>
          <div id="v-steps">${v && v.items ? UI.checklist(v.items) : ""}</div>
          ${
            v && v.notFound
              ? `<div class="callout callout-bad">Project #${v.notFound} does not exist on this ledger.</div>`
              : p
              ? `<div style="margin-top:${v.items ? "14px" : "0"}">${recordHtml(p, data)}</div>`
              : v && v.mode === "report"
              ? v.closest
                ? `<div class="callout ${v.closest.score >= C.NEAR_DUP ? "callout-bad" : "callout-warn"}" style="margin-top:14px"><strong>No exact match.</strong> The closest record is
                   #${v.closest.id} "${esc(data.project(v.closest.id).title)}" by ${esc(collegeName(data.project(v.closest.id).college))}, ${pct(v.closest.score)} similar.
                   ${v.closest.score >= C.NEAR_DUP ? "This report looks like a reworded copy of it." : ""} <a href="#/verify?id=${v.closest.id}">Open #${v.closest.id}</a></div>`
                : `<div class="callout callout-warn" style="margin-top:14px"><strong>Not on the ledger.</strong> No college has registered this report, and nothing similar exists.</div>`
              : `<p class="muted">Enter a project ID (for example from a student's CV) or check a report. A verified project gets a printable certificate.</p>`
          }
        </div>
      </div>
      ${
        p && p.status === ST.Verified
          ? `<div class="card" style="margin-bottom:16px">
              <div class="card-head"><h2>Certificate</h2><div class="row">
                <button type="button" class="btn" id="print-btn">Print certificate</button>
                <button type="button" class="btn btn-secondary" id="dl-cert-btn">Download (.html)</button>
                <button type="button" class="btn btn-ghost" id="link-btn">Copy link</button></div></div>
              <div class="certificate" id="certificate">${certificateInner(p, data)}</div>
            </div>`
          : p
          ? `<div class="card callout-warn" style="margin-bottom:16px"><strong>No certificate.</strong> A certificate is issued only for projects with the status <em>Verified</em>. This one is ${esc(STATUS_UI[p.status].label.toLowerCase())}.</div>`
          : ""
      }
      ${
        p
          ? `<form class="card" id="team-form" autocomplete="off">
              <div class="card-head"><h2>Confirm the team</h2><span class="muted small">Privacy-preserving: student identities are not on-chain</span></div>
              <p class="muted small" style="margin-top:0">A student shares the roll numbers and the salt from their college's verification pack. The browser recomputes SHA-256(salt | sorted roll numbers) and compares it with the team hash on-chain.</p>
              <div class="grid-2 tight">
                <div class="field"><label for="t-rolls">Roll numbers (all team members)</label><input id="t-rolls" type="text" placeholder="21RIT014, 21RIT027, 21RIT033" value="${esc(ti.rolls)}"></div>
                <div class="field"><label for="t-salt">Salt</label><input id="t-salt" type="text" placeholder="0x…" value="${esc(ti.salt)}"></div>
              </div>
              <div class="row"><button class="btn" type="submit" id="t-btn">Check team hash</button>
                ${teamRecordOf(p) ? `<button type="button" class="btn btn-ghost btn-sm" id="t-demo">Fill from the college's pack (demo)</button>` : ""}
                <label class="btn btn-ghost btn-sm">Load pack file<input type="file" id="t-file" accept=".txt" hidden></label></div>
              ${
                tc
                  ? `<div class="callout ${tc.ok ? "callout-ok" : "callout-bad"}" style="margin-top:12px">${
                      tc.ok
                        ? `<strong>Team confirmed.</strong> These ${tc.count} roll numbers and the salt reproduce the on-chain team hash of project #${p.id}.`
                        : `<strong>No match.</strong> SHA-256 gives ${UI.short(tc.computed, 8)}, not ${UI.short(p.teamHash, 8)}. The roll numbers or the salt are wrong, or the list is incomplete.`
                    }</div>`
                  : ""
              }
            </form>`
          : ""
      }`;

    el.querySelector("#id-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = Number(el.querySelector("#v-id").value);
      state.teamCheck = null;
      state.verify = { mode: "id", id: data.project(id) ? id : null, notFound: data.project(id) ? null : id || "?" };
      Shell.render();
    });
    el.querySelector("#v-text").addEventListener("input", (e) => (state.verifyText = e.target.value));
    el.querySelector("#v-sample").addEventListener("change", (e) => {
      const s = samples.find((x) => x.key === e.target.value);
      if (!s) return;
      state.verifyText = s.text;
      el.querySelector("#v-text").value = s.text;
    });
    el.querySelector("#v-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > C.MAX_TEXT) return UI.toast("Reports up to 200 KB of text only.", "error");
      state.verifyText = await UI.readFileText(file);
      el.querySelector("#v-text").value = state.verifyText;
      action(el.querySelector("#v-text-btn"), () => verifyReport(state.verifyText, data));
    });
    el.querySelector("#text-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.teamCheck = null;
      const text = el.querySelector("#v-text").value;
      if (!text.trim()) return UI.toast("Paste, upload or load a report first.", "error");
      action(el.querySelector("#v-text-btn"), () => verifyReport(text, data));
    });
    const pb = el.querySelector("#print-btn");
    if (pb) pb.addEventListener("click", printCertificate);
    const dl = el.querySelector("#dl-cert-btn");
    if (dl) dl.addEventListener("click", () => UI.download(`project-${p.id}-certificate.html`, certificateDoc(p, data), "text/html"));
    const lb = el.querySelector("#link-btn");
    if (lb) lb.addEventListener("click", () => UI.copy(verifyUrl(p.id)));
    const tf = el.querySelector("#team-form");
    if (tf) {
      tf.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!ti.rolls.trim() || !ti.salt.trim()) return UI.toast("Enter the roll numbers and the salt from the verification pack.", "error");
        action(el.querySelector("#t-btn"), async () => {
          state.teamCheck = await checkTeam(p, ti.salt, ti.rolls);
        });
      });
      const fillFrom = (salt, rolls) => {
        ti.salt = el.querySelector("#t-salt").value = salt;
        ti.rolls = el.querySelector("#t-rolls").value = rolls.join(", ");
      };
      el.querySelector("#t-salt").addEventListener("input", (e) => (ti.salt = e.target.value));
      el.querySelector("#t-rolls").addEventListener("input", (e) => (ti.rolls = e.target.value));
      const td = el.querySelector("#t-demo");
      if (td)
        td.addEventListener("click", () => {
          const t = teamRecordOf(p);
          fillFrom(t.salt, t.members.map((m) => m.roll));
        });
      el.querySelector("#t-file").addEventListener("change", async (e) => {
        const text = await UI.readFileText(e.target.files[0]);
        const salt = (text.match(/^Salt:\s*(\S+)/m) || [])[1];
        const rolls = (text.match(/^Roll numbers:\s*(.+)$/m) || [])[1];
        if (!salt || !rolls) return UI.toast("This file is not a ProjectLedger verification pack.", "error");
        fillFrom(salt, rolls.split(/\s*,\s*/));
      });
    }
  }

  // ---------- Similarity checker ----------
  async function viewSimilarity(el, { data, state, action }) {
    const samples = [...sampleByHash.values()];
    const sm = (state.sim = state.sim || { a: "s:irrigation-copy", b: "p:1", aText: "", bText: "" });
    if (sm.b === "p:1" && !data.project(1)) sm.b = "ledger";
    const options = (sel, withLedger) => `
      ${withLedger ? `<option value="ledger" ${sel === "ledger" ? "selected" : ""}>Every project on the ledger (scan)</option>` : ""}
      <option value="paste" ${sel === "paste" ? "selected" : ""}>Pasted / uploaded text</option>
      <optgroup label="Projects on the ledger">${data.projects
        .map((p) => `<option value="p:${p.id}" ${sel === "p:" + p.id ? "selected" : ""}>#${p.id} ${esc(p.title)} (${esc(collegeCode(data, p.college))})</option>`)
        .join("")}</optgroup>
      <optgroup label="Built-in sample reports">${samples.map((s) => `<option value="s:${s.key}" ${sel === "s:" + s.key ? "selected" : ""}>${esc(s.title)}</option>`).join("")}</optgroup>`;
    const docOf = (ref, text, side) => {
      if (ref === "paste") return C.normalizeReport(text) ? docOfText(`Pasted text ${side}`, "not on the ledger", text) : null;
      if (ref.startsWith("p:")) return data.project(ref.slice(2)) ? docOfProject(data.project(ref.slice(2))) : null;
      const s = S.sample(ref.slice(2));
      return s ? docOfText(s.title, `sample report · ${S.COLLEGES[s.college - 1].code} · ${s.year}`, S.reportText(s)) : null;
    };
    const res = sm.result;
    let resultHtml = `<p class="muted">Choose two reports and click <em>Compare</em>. The MinHash estimate uses the same 128-byte fingerprints that are stored on-chain; the exact overlap needs both texts.</p>`;
    if (res && res.kind === "pair") resultHtml = compareHtml(res.A, res.B);
    if (res && res.kind === "scan")
      resultHtml = `<p class="small muted" style="margin-top:0">${esc(res.A.label)} against ${res.rows.length} projects</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th>Similarity</th><th></th></tr></thead><tbody>${res.rows
          .map(
            ({ p, score }) => `<tr><td data-label="Project"><strong>#${p.id} ${esc(p.title)}</strong><div class="muted small">${esc(collegeName(p.college))} · ${p.year} · ${STATUS_UI[p.status].label}</div></td>
            <td data-label="Similarity"><span class="bar-wrap"><span class="bar ${score >= C.NEAR_DUP ? "bar-bad" : score >= C.RELATED ? "bar-warn" : ""}" style="width:${Math.max(2, Math.round(score * 100))}%"></span></span> ${pct(score)}</td>
            <td data-label=""><button type="button" class="btn btn-ghost btn-sm" data-pick="p:${p.id}">Compare</button></td></tr>`
          )
          .join("")}</tbody></table></div>`;

    el.innerHTML = `
      ${pageHead("Similarity Checker", "Compare any two reports, or scan a text against every fingerprint on the ledger. Near-duplicates (MinHash similarity of 50% or more) are what colleges flag during peer review.")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <div class="card"><div class="card-head"><h2>Report A</h2></div>
          <div class="field"><label for="sim-a" class="sr-only">Report A</label><select id="sim-a">${options(sm.a, false)}</select></div>
          <div class="field ${sm.a === "paste" ? "" : "hidden"}"><textarea id="sim-a-text" rows="6" placeholder="Paste report A…">${esc(sm.aText)}</textarea>
            <label class="btn btn-secondary btn-sm" style="align-self:flex-start">${Shell.icon("upload")} Upload .txt<input type="file" id="sim-a-file" accept=".txt,.md,text/plain" hidden></label></div>
        </div>
        <div class="card"><div class="card-head"><h2>Report B</h2></div>
          <div class="field"><label for="sim-b" class="sr-only">Report B</label><select id="sim-b">${options(sm.b, true)}</select></div>
          <div class="field ${sm.b === "paste" ? "" : "hidden"}"><textarea id="sim-b-text" rows="6" placeholder="Paste report B…">${esc(sm.bText)}</textarea></div>
        </div>
      </div>
      <div class="row" style="margin-bottom:16px"><button type="button" class="btn" id="sim-btn">${Shell.icon("layers")} Compare</button>
        <span class="muted small">MinHash: 3-word shingles, 32 hash functions, similarity = equal slots ÷ 32</span></div>
      <div class="card" id="sim-result"><div class="card-head"><h2>Result</h2></div>${resultHtml}</div>`;

    const sa = el.querySelector("#sim-a");
    const sb = el.querySelector("#sim-b");
    sa.addEventListener("change", () => {
      sm.a = sa.value;
      Shell.render();
    });
    sb.addEventListener("change", () => {
      sm.b = sb.value;
      Shell.render();
    });
    el.querySelector("#sim-a-text").addEventListener("input", (e) => (sm.aText = e.target.value));
    el.querySelector("#sim-b-text").addEventListener("input", (e) => (sm.bText = e.target.value));
    el.querySelector("#sim-a-file").addEventListener("change", async (e) => {
      if (!e.target.files[0]) return;
      sm.aText = await UI.readFileText(e.target.files[0]);
      Shell.render();
    });
    el.querySelector("#sim-btn").addEventListener("click", (e) => {
      const A = docOf(sm.a, sm.aText, "A");
      const B = sm.b === "ledger" ? null : docOf(sm.b, sm.bText, "B");
      if (!A) return UI.toast("Report A is empty: paste or upload a text.", "error");
      if (sm.b !== "ledger" && !B) return UI.toast("Report B is empty: paste a text.", "error");
      action(e.currentTarget, async () => {
        sm.result = B ? { kind: "pair", A, B } : { kind: "scan", A, rows: scan(A.sig, data, A.id || 0) };
      });
    });
    el.querySelectorAll("[data-pick]").forEach((b) =>
      b.addEventListener("click", () =>
        action(b, async () => {
          sm.b = b.dataset.pick;
          sm.result = { kind: "pair", A: docOf(sm.a, sm.aText, "A"), B: docOf(sm.b, sm.bText, "B") };
        })
      )
    );
  }

  // ---------- Explorer & About ----------
  function formatEvent(e) {
    const a = e.args;
    switch (e.name) {
      case "CollegeAdded":
        return `${a.name} (${a.code}) admitted to the consortium`;
      case "CollegeStatusChanged":
        return `${Chain.label(a.college)} ${a.active ? "re-activated" : "suspended"}`;
      case "ThresholdChanged":
        return `Endorsement policy changed from ${a.oldThreshold} to ${a.newThreshold} colleges`;
      case "ProjectRegistered":
        return `${Chain.label(a.college)} registered #${a.id} "${a.title}" (${a.year}) · report ${UI.short(a.reportHash, 4)} · needs ${a.required} endorsements${
          Number(a.similarToId) ? ` · declared similar to #${a.similarToId}` : ""
        }`;
      case "ProjectEndorsed":
        return `${Chain.label(a.college)} endorsed #${a.id} (${a.endorsements} of ${a.required})`;
      case "ProjectVerified":
        return `#${a.id} VERIFIED with ${a.endorsements} endorsements`;
      case "ProjectFlagged":
        return `${Chain.label(a.college)} flagged #${a.id} as a suspected duplicate${Number(a.similarToId) ? ` of #${a.similarToId}` : ""}: ${a.reason}`;
      case "DisputeResolved":
        return `Board ${a.upheld ? "upheld" : "dismissed"} the dispute on #${a.id} → ${STATUS_UI[Number(a.newStatus)].label}: ${a.note}`;
      case "ProjectRevoked":
        return `#${a.id} revoked by its college: ${a.reason}`;
      default:
        return "";
    }
  }

  async function viewExplorer(el) {
    el.innerHTML = `${pageHead("Blockchain Explorer", "Every registration, endorsement, flag and ruling is a transaction in a block. Each block stores the hash of the previous one, so no college can quietly rewrite an old record.")}<div id="explorer-host"></div>`;
    await Explorer.render(el.querySelector("#explorer-host"), { formatEvent });
  }

  async function viewAbout(el) {
    el.innerHTML = `
      ${pageHead("About the project", "ProjectLedger: a consortium blockchain for inter-college final-year project verification, with an endorsement policy and similarity-based duplicate detection.")}
      <div class="stack">
        <div class="card">
          <h2>Problem</h2>
          <p style="margin-top:8px">Final-year project records live in isolated college databases. Employers and universities cannot easily confirm that a student really did a project, and the same report is often re-submitted, lightly reworded, at another college or in a later year without anyone noticing, because no college can see the others' records.</p>
          <h2 style="margin-top:14px">Solution</h2>
          <ul style="margin:8px 0 0;padding-left:18px">
            <li><strong>Shared ledger:</strong> every college writes its projects to one consortium blockchain, so a duplicate anywhere is visible everywhere.</li>
            <li><strong>Endorsement policy:</strong> a record becomes <em>Verified</em> only when K of N colleges endorse it (the owner counts as one). One college alone cannot certify its own projects.</li>
            <li><strong>Exact and near-duplicate detection:</strong> the contract refuses a report whose SHA-256 is already on-chain; a MinHash fingerprint lets any college find reworded copies before registering or during review.</li>
            <li><strong>Disputes:</strong> any other college can flag a suspected copy; the consortium board rules, and a rejected record stays visible to employers.</li>
            <li><strong>Privacy:</strong> student names and roll numbers never go on-chain, only initials and a salted hash.</li>
          </ul>
        </div>
        <div class="card">
          <h2>Syllabus mapping (22CS743)</h2>
          <div class="table-wrap" style="margin-top:8px"><table class="table"><thead><tr><th>Module</th><th>Concept</th><th>Where it is used</th></tr></thead><tbody>
            <tr><td data-label="Module">II</td><td data-label="Concept">Hash functions, hash-based similarity (MinHash), simple consensus rule, hash-linked blocks</td><td data-label="Used in">SHA-256 report hash and salted team hash; MinHash over 3-word shingles with 32 hash functions; "K of N endorsements" as the agreement rule; the explorer checks every block's previous-hash link</td></tr>
            <tr><td data-label="Module">III</td><td data-label="Concept">Ethereum, EVM, smart contracts, signed transactions</td><td data-label="Used in"><code>ProjectConsortium.sol</code> enforces the endorsement policy, uniqueness of report hashes, the 30-day review window and dispute rules; every registration, endorsement and flag is a transaction signed by the college's account</td></tr>
            <tr><td data-label="Module">IV</td><td data-label="Concept">Consortium blockchain, endorsement policy as in Hyperledger Fabric</td><td data-label="Used in">Only colleges admitted by the board take part; a project needs endorsements from K of the member organisations, the same idea as a Fabric policy such as <code>OutOf(2, 'RIT.member', 'NCE.member', …)</code></td></tr>
            <tr><td data-label="Module">V</td><td data-label="Concept">Applications in education, privacy, fraud detection, access control</td><td data-label="Used in">Verifiable academic records and certificates, plagiarism detection across colleges, salted hashes instead of personal data, role checks for board and colleges</td></tr>
          </tbody></table></div>
        </div>
        <div class="card">
          <h2>How this relates to Hyperledger Fabric (honestly)</h2>
          <p style="margin-top:8px">In Fabric, a client sends a transaction proposal to endorsing peers of several organisations; each peer simulates the chaincode and signs the result; the ordering service orders the transaction, and peers validate it against the <em>endorsement policy</em> before committing it.</p>
          <p>This demo runs on an <strong>Ethereum (EVM) chain</strong>, not on Fabric. The endorsement policy is emulated at the application level: each endorsement is a separate signed transaction, and the smart contract counts them and switches the record to <em>Verified</em> when the threshold is reached. The effect for the use case is the same (no single college can certify a project), but the endorsements happen after ordering, one block at a time, instead of before it.</p>
        </div>
        <div class="grid-2">
          <div class="card">
            <h2>On-chain vs off-chain</h2>
            <ul style="margin:6px 0 0;padding-left:18px">
              <li><strong>On-chain:</strong> colleges, the threshold, project title, domain, year, guide, team initials, report SHA-256, MinHash fingerprint (128 bytes), team hash, endorsements, flags, rulings.</li>
              <li><strong>Off-chain (with the college):</strong> the full report, student names and roll numbers, and the team salt. A student gets a verification pack with the salt to prove membership to an employer.</li>
            </ul>
          </div>
          <div class="card">
            <h2>Technology</h2>
            <ul style="margin:6px 0 0;padding-left:18px">
              <li>Solidity 0.8.24 smart contract, Hardhat (local blockchain + 22 tests)</li>
              <li>In-browser Ethereum chain (Ganache) for zero-install demos</li>
              <li>ethers.js v6, Web Crypto API (SHA-256)</li>
              <li>MinHash: FNV-1a 32-bit base hash, 32 functions (a·x + b) mod 4294967311</li>
              <li>qr.js for the certificate QR code; HTML, CSS and JavaScript (no build step)</li>
            </ul>
          </div>
        </div>
        <div class="card">
          <h2>MinHash in one paragraph</h2>
          <p style="margin-top:8px">The report is lower-cased, common words are removed, and every run of three consecutive words becomes a <em>shingle</em>. Each shingle is hashed with FNV-1a, then with 32 different functions h<sub>i</sub>(x) = (a<sub>i</sub>·x + b<sub>i</sub>) mod 4294967311. For each function the smallest value over all shingles is kept. Two reports agree in a slot with probability equal to the Jaccard similarity of their shingle sets, so the fraction of equal slots estimates it. 32 slots fit in 128 bytes on-chain; the estimate is within about ±9 percentage points, which is enough to raise a flag that a human then checks side by side.</p>
        </div>
        <div class="card callout-warn">
          <h2>Limitations</h2>
          <ul style="margin:6px 0 0;padding-left:18px">
            <li>MinHash finds copied wording. A report that is fully paraphrased or translated will not match; that needs semantic similarity models.</li>
            <li>The full texts are compared only when both are available to the reviewer; otherwise only the fingerprints are compared.</li>
            <li>Fingerprints are public. They do not reveal the text, but anyone holding a candidate text can test whether it is on the ledger.</li>
            <li>In the demo, every college's off-chain store lives in this browser. Real colleges would keep reports in their own repositories and sign with their own keys.</li>
          </ul>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------
  let renders = 0; // completed page renders (lets automated tests wait for a re-render)
  const counted = (view) => async (el, ctx) => {
    try {
      await view(el, ctx);
    } finally {
      renders++;
    }
  };

  Shell.start({
    brand: { name: "ProjectLedger", tagline: "Consortium blockchain for inter-college project verification", icon: "school" },
    timeTravel: true,
    load,
    chain: {
      storageKey: "projectledger",
      artifact: window.CONTRACT_ARTIFACT,
      errors: ERRORS,
      async isSeeded(chain) {
        const [accts] = await chain.contract.getColleges();
        return accts.length > 0;
      },
      async seed(chain) {
        const admin = chain.accounts[0];
        for (const col of S.COLLEGES) await chain.send(admin, "addCollege", [chain.accounts[col.account], col.name, col.code]);
        const infos = await samplesReady();
        let id = 0;
        for (const step of S.SEED_PLAN) {
          const info = infos.find((x) => x.key === step.key);
          const reg = await sampleRegistration(info);
          await chain.send(chain.accounts[info.college], "registerProject", reg.args);
          id += 1;
          for (const e of step.endorsers) await chain.send(chain.accounts[e], "endorseProject", [id]);
        }
      },
    },
    routes: [
      { id: "home", title: "Overview", icon: "home", render: counted(viewHome) },
      { id: "college", title: "College", icon: "school", section: "Roles", render: counted(viewCollege) },
      { id: "review", title: "Peer Review", icon: "check", section: "Roles", render: counted(viewReview) },
      { id: "board", title: "Consortium Board", icon: "users", section: "Roles", render: counted(viewBoard) },
      { id: "verify", title: "Verify Project", icon: "shield", section: "Public", render: counted(viewVerify) },
      { id: "similarity", title: "Similarity Checker", icon: "layers", section: "Public", render: counted(viewSimilarity) },
      { id: "explorer", title: "Blockchain Explorer", icon: "blocks", section: "Public", render: counted(viewExplorer) },
      { id: "about", title: "About & Syllabus", icon: "book", section: "Project", render: counted(viewAbout) },
    ],
  });

  // Exposed for automated tests.
  window.ProjectLedgerApp = {
    get renders() {
      return renders;
    },
    load,
    registerProject,
    endorseProject,
    flagProject,
    resolveDispute,
    revokeProject,
    verifyReport,
    checkTeam,
    certificateDoc,
    teamRecordOf,
    reportTextOf,
    samplesReady,
    sampleRegistration,
  };
})();
