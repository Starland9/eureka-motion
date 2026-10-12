# Self-hosted fonts

Fonts served locally by both the web interface and the animated scenes (no CDN call, see
`design-system/eureka-motion/MASTER.md` section 2.3). Task T007 of
`specs/001-animated-concept-explainer/tasks.md`.

Every file in this folder is a **complete, unmodified upstream WOFF2** (no Google Fonts
`unicode-range` subsets, no re-compression, no subsetting, no conversion done here). Each
file was copied byte-for-byte from the release or repository named below, so the SIL OFL
"Reserved Font Name" conditions are not triggered.

## Files

All licences are the SIL Open Font License 1.1 (OFL-1.1). Sizes are in bytes (KiB in
brackets). Text fonts: 8 files, 699,932 bytes (683.5 KiB). KaTeX: 20 files, 259,792 bytes
(253.7 KiB).

| File | Family | Style | Axes / weight | Size | Upstream version | Licence file |
|---|---|---|---|---|---|---|
| `bodoni-moda-variable.woff2` | Bodoni Moda | roman, variable | `opsz` 6-96 (default 11), `wght` 400-900 | 74,372 (72.6) | 2.005 | `OFL-bodoni-moda.txt` |
| `bodoni-moda-variable-italic.woff2` | Bodoni Moda | italic, variable | `opsz` 6-96 (default 11), `wght` 400-900 | 85,000 (83.0) | 2.005 | `OFL-bodoni-moda.txt` |
| `stix-two-text-variable.woff2` | STIX Two Text | roman, variable | `wght` 400-700 | 158,184 (154.5) | 2.13 b171 | `OFL-stix-two-text.txt` |
| `stix-two-text-variable-italic.woff2` | STIX Two Text | italic, variable | `wght` 400-700 | 174,452 (170.4) | 2.13 b171 | `OFL-stix-two-text.txt` |
| `ibm-plex-mono-400.woff2` | IBM Plex Mono | roman, static | 400 (Regular) | 49,248 (48.1) | 2.005 (package 2.5.0) | `OFL-ibm-plex-mono.txt` |
| `ibm-plex-mono-400-italic.woff2` | IBM Plex Mono | italic, static | 400 (Italic) | 53,408 (52.2) | 2.005 (package 2.5.0) | `OFL-ibm-plex-mono.txt` |
| `ibm-plex-mono-500.woff2` | IBM Plex Mono | roman, static | 500 (Medium) | 50,400 (49.2) | 2.005 (package 2.5.0) | `OFL-ibm-plex-mono.txt` |
| `ibm-plex-mono-500-italic.woff2` | IBM Plex Mono | italic, static | 500 (Medium Italic) | 54,868 (53.6) | 2.005 (package 2.5.0) | `OFL-ibm-plex-mono.txt` |
| `katex/KaTeX_*.woff2` (20 files, listed below) | KaTeX fonts (Computer Modern based) | various, static | n/a | see below | 1.1 (package 0.19.0) | `OFL-katex.txt` |

Licence files: `OFL-bodoni-moda.txt`, `OFL-stix-two-text.txt`, `OFL-ibm-plex-mono.txt` and
`OFL-katex.txt` (details in "Licence files" below).

### Upstream sources

Bodoni Moda (Owen Earl, Indestructible Type)
- Repository: <https://github.com/indestructible-type/Bodoni>
- Commit: `30ce6cdc354ef179a3b72ba0f0e71826e599348c` (2024-02-18, head of `master`; the same
  commit Google Fonts packaged as "Version 2.005").
- Files: `fonts/webfonts/BodoniModa[opsz,wght].woff2` and
  `fonts/webfonts/BodoniModa-Italic[opsz,wght].woff2` at that commit, e.g.
  <https://raw.githubusercontent.com/indestructible-type/Bodoni/30ce6cdc354ef179a3b72ba0f0e71826e599348c/fonts/webfonts/BodoniModa%5Bopsz%2Cwght%5D.woff2>
- Licence: `OFL.txt` at the same commit. Copyright 2020 The Bodoni Moda Project Authors. No
  Reserved Font Name.

STIX Two Text (Tiro Typeworks, Ross Mills, John Hudson, Paul Hanslow; STIX Fonts project)
- Repository: <https://github.com/stipub/stixfonts>
- Commit: `c4afdf3fa5390159ef24aca1db5e957487c23897` (2025-03-17, the commit pinned by
  `google/fonts` `ofl/stixtwotext/METADATA.pb`; font version "2.13 b171", tag `v2.13b171`).
- Files: `fonts/variable_ttf_woff2/STIXTwoText[wght].woff2` and
  `fonts/variable_ttf_woff2/STIXTwoText-Italic[wght].woff2` at that commit, e.g.
  <https://raw.githubusercontent.com/stipub/stixfonts/c4afdf3fa5390159ef24aca1db5e957487c23897/fonts/variable_ttf_woff2/STIXTwoText%5Bwght%5D.woff2>
- Licence: `OFL.txt` at the same commit. Copyright 2001-2021 The STIX Fonts Project Authors,
  Reserved Font Name "TM Math"; STIX Fonts is a trademark of the IEEE.
- Note: the `fonts/` folder was removed from `master` after that commit (v2.14 interim build
  conversion), hence the pinned commit.

IBM Plex Mono (Mike Abbink, Bold Monday for IBM)
- Repository: <https://github.com/IBM/plex>
- Release: `@ibm/plex-mono@2.5.0` (tag object `c71cbdbeb76cae994c88a81f391f97748280dd35`,
  commit `2f9ba1b25957d958db71a849e85d72e3ecfb845a`, published 2026-06-11).
- Archive: <https://github.com/IBM/plex/releases/download/%40ibm/plex-mono%402.5.0/ibm-plex-mono.zip>
  (sha256 `6d23f01257663d8cc49a0d64c22ced630b79e0e2a0ac08a0da86e9a38bbc481c`).
- Files: `ibm-plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2` (to `-400`),
  `-Italic.woff2` (to `-400-italic`), `-Medium.woff2` (to `-500`),
  `-MediumItalic.woff2` (to `-500-italic`). The `fonts/split/` (unicode-range) variants were
  not used.
- Licence: `ibm-plex-mono/LICENSE.txt` from the archive (copied unchanged, CRLF line
  endings kept). Copyright 2017 IBM Corp., Reserved Font Name "Plex".
- Why not the Google Fonts copy: `google/fonts` `ofl/ibmplexmono/` ships version 2.3 with 930
  code points; the IBM release has 1,049 (a strict superset) including U+202F, plus the
  `zero`, `sups`, `subs`, `sinf` and stylistic-set features.

KaTeX fonts (Design Science, Inc. / Khan Academy; Computer Modern based)
- Source: the `katex@0.19.0` npm package, `dist/fonts/*.woff2`, copied read-only from the
  repository `node_modules` (`node_modules/.pnpm/katex@0.19.0/node_modules/katex/dist/fonts/`).
- Cross-check: the 20 files are byte-identical to `fonts/*.woff2` at the upstream git tag
  `v0.19.0` (commit `6ea2dc97188f0cc282e05a9690418ae7fe5457ba`) of
  <https://github.com/KaTeX/KaTeX>.
- File names are kept as published (`KaTeX_Main-Regular.woff2`, ...) because `katex.css`
  references them by these exact names; they are therefore not kebab-case.
- Licence: SIL OFL-1.1, see `OFL-katex.txt` below.

#### KaTeX files (`katex/`)

| File | Size (bytes) |
|---|---|
| `KaTeX_AMS-Regular.woff2` | 28,076 |
| `KaTeX_Caligraphic-Bold.woff2` | 6,912 |
| `KaTeX_Caligraphic-Regular.woff2` | 6,908 |
| `KaTeX_Fraktur-Bold.woff2` | 11,348 |
| `KaTeX_Fraktur-Regular.woff2` | 11,316 |
| `KaTeX_Main-Bold.woff2` | 25,324 |
| `KaTeX_Main-BoldItalic.woff2` | 16,780 |
| `KaTeX_Main-Italic.woff2` | 16,988 |
| `KaTeX_Main-Regular.woff2` | 26,272 |
| `KaTeX_Math-BoldItalic.woff2` | 16,400 |
| `KaTeX_Math-Italic.woff2` | 16,440 |
| `KaTeX_SansSerif-Bold.woff2` | 12,216 |
| `KaTeX_SansSerif-Italic.woff2` | 12,028 |
| `KaTeX_SansSerif-Regular.woff2` | 10,344 |
| `KaTeX_Script-Regular.woff2` | 9,644 |
| `KaTeX_Size1-Regular.woff2` | 5,468 |
| `KaTeX_Size2-Regular.woff2` | 5,208 |
| `KaTeX_Size3-Regular.woff2` | 3,624 |
| `KaTeX_Size4-Regular.woff2` | 4,928 |
| `KaTeX_Typewriter-Regular.woff2` | 13,568 |

### Licence files

| File | Origin |
|---|---|
| `OFL-bodoni-moda.txt` | `OFL.txt` of `indestructible-type/Bodoni` at `30ce6cd` (unchanged). |
| `OFL-stix-two-text.txt` | `OFL.txt` of `stipub/stixfonts` at `c4afdf3` (unchanged). |
| `OFL-ibm-plex-mono.txt` | `LICENSE.txt` of the `@ibm/plex-mono@2.5.0` release archive (unchanged). |
| `OFL-katex.txt` | Composed here. Neither the `katex` npm package nor the KaTeX repository ships a separate font licence file (the repository `LICENSE` is MIT and covers the code only). The fonts themselves carry the licence notice in their `name` table (ID 13): OFL-1.1, copyright 2009-2010 Design Science, Inc. and 2014-2018 Khan Academy, Reserved Font Names `KaTeX_AMS`, `KaTeX_Caligraphic`, `KaTeX_Fraktur`, `KaTeX_Main`, `KaTeX_Math`, `KaTeX_SansSerif`, `KaTeX_Script`, `KaTeX_Size1-4`, `KaTeX_Typewriter`. The file is that notice followed by the standard OFL-1.1 text (taken unchanged from the Bodoni Moda `OFL.txt`; the OFL body is identical in the Bodoni, STIX and Plex files). |

## Verification (fonttools)

Checked on the delivered files with fonttools (Python): every file starts with the `wOF2`
signature and loads as a WOFF2 flavour; the 20 KaTeX files are byte-identical to the
installed package and to the git tag.

### Variable axes (`fvar` table)

| File | `fvar` axes found (tag: min / default / max) | Named instances | Expected | Result |
|---|---|---|---|---|
| `bodoni-moda-variable.woff2` | `wght`: 400 / 400 / 900; `opsz`: 6 / 11 / 96 | 6 | `opsz` 6-96, `wght` 400-900 | match |
| `bodoni-moda-variable-italic.woff2` | `wght`: 400 / 400 / 900; `opsz`: 6 / 11 / 96 | 6 | `opsz` 6-96, `wght` 400-900 | match |
| `stix-two-text-variable.woff2` | `wght`: 400 / 400 / 700 | 4 | `wght` 400-700 | match |
| `stix-two-text-variable-italic.woff2` | `wght`: 400 / 400 / 700 | 4 | `wght` 400-700 | match |

The four IBM Plex Mono files are static (no `fvar`); their `OS/2` weight classes are 400,
400, 500 and 500.

The decoded Bodoni Moda and STIX Two Text fonts have the same character map and glyph order
as the TTF files in `google/fonts` (commit `66928797f271fed5ee428544e7229685e2d90127`,
2026-10-12), which confirms the WOFF2 files are the complete fonts.

## Coverage check

Character map (`cmap`) check of each text font (KaTeX not checked). Missing characters are
listed explicitly; "none" means every character of the set is present. No attempt was made to
fix missing glyphs: fallbacks are a design decision.

Sets:
1. French: `é è ê ë à â ç î ï ô ù û ü œ æ É È À Ç Œ « » ’ … — –` (26 characters)
2. Spaces: U+00A0 no-break space, U+202F narrow no-break space (2 characters)
3. Math in running text: `× − ± ≈ ≤ ≥ ≠ → · ° ′ ∞ √ π Δ α β θ λ μ ω Ω` (22 characters)
4. Superscripts and subscripts: `⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁻ ⁺ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉` (22 characters)

| Font file | Code points in `cmap` | 1 French | 2 Spaces | 3 Math | 4 Sup/sub |
|---|---|---|---|---|---|
| `bodoni-moda-variable.woff2` | 428 | none | U+202F | `→` U+2192, `′` U+2032, `α` U+03B1, `β` U+03B2, `θ` U+03B8, `λ` U+03BB, `ω` U+03C9 (7) | `⁰` U+2070, `⁵` U+2075, `⁶` U+2076, `⁷` U+2077, `⁸` U+2078, `⁹` U+2079, `⁻` U+207B, `⁺` U+207A, `₀` U+2080, `₁` U+2081, `₂` U+2082, `₃` U+2083, `₄` U+2084, `₅` U+2085, `₆` U+2086, `₇` U+2087, `₈` U+2088, `₉` U+2089 (18; only `¹ ² ³ ⁴` present) |
| `bodoni-moda-variable-italic.woff2` | 428 | none | U+202F | same 7 as roman | same 18 as roman |
| `stix-two-text-variable.woff2` | 1,281 | none | none | `≈` U+2248, `≤` U+2264, `≥` U+2265, `≠` U+2260, `→` U+2192, `∞` U+221E, `√` U+221A (7) | none |
| `stix-two-text-variable-italic.woff2` | 1,281 | none | none | same 7 as roman | none |
| `ibm-plex-mono-400.woff2` | 1,049 | none | none | `Δ` U+0394, `α` U+03B1, `β` U+03B2, `θ` U+03B8, `λ` U+03BB, `μ` U+03BC, `ω` U+03C9, `Ω` U+03A9 (8) | `⁻` U+207B, `⁺` U+207A (2) |
| `ibm-plex-mono-400-italic.woff2` | 1,049 | none | none | same 8 as 400 | same 2 as 400 |
| `ibm-plex-mono-500.woff2` | 1,049 | none | none | same 8 as 400 | same 2 as 400 |
| `ibm-plex-mono-500-italic.woff2` | 1,049 | none | none | same 8 as 400 | same 2 as 400 |

Informational (code points checked on the delivered files, not a fix):
- IBM Plex Mono has the look-alikes U+00B5 (micro sign, for `μ`), U+2206 (increment, for
  `Δ`) and U+2126 (ohm sign, for `Ω`), and has `π` U+03C0, but no other Greek letter.
- STIX Two Text has `Δ` U+0394, `Ω` U+03A9, all Greek letters of set 3 and U+2126; it has no
  arrow or relation symbol (`≈ ≤ ≥ ≠ → ∞ √` are in STIX Two Math, which is not shipped).
- Bodoni Moda has `π` U+03C0, `Δ` U+0394, `Ω` U+03A9 and U+00B5 but not U+2206 or U+2126; it
  has the `sups` feature, which may cover some superscript digits through OpenType
  substitution (not tested).
- OpenType features present: Bodoni Moda `frac lnum onum ordn pnum sups tnum`; STIX Two Text
  `dnom frac numr onum pnum subs sups` (no `tnum`); IBM Plex Mono `dnom frac lnum numr onum
  ordn sinf subs sups zero` plus stylistic sets (it is monospaced, so digits are tabular).

## Checksums (sha256)

```
62755d5579f65068ef031614a3214a56bbe3c95d45fa957f8789a1fa931a8dbe  bodoni-moda-variable-italic.woff2
99846cc37bb4b3f43db103b15e259f333df784dd6252331f327d2cea7ceea6fb  bodoni-moda-variable.woff2
2024bf2b08027dcd6d09091385756e327744bbe26b782c411381dffc40ffc622  ibm-plex-mono-400-italic.woff2
ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350  ibm-plex-mono-400.woff2
782325462f9a9708e02cb0415445cef7c9b5ee74f8910f33bfd1ab405a3402d2  ibm-plex-mono-500-italic.woff2
33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25  ibm-plex-mono-500.woff2
a5e3f5f788a93cd23f015f6d6e1cc64b3239ad0a798aec5032c6be18e165f78d  stix-two-text-variable-italic.woff2
e2a13a91ad5d98da25a6972e8b19ce216e1997037004d9051290d0094b10a58b  stix-two-text-variable.woff2
```

The KaTeX files are identical to `katex@0.19.0` `dist/fonts/*.woff2`; use
`sha256sum katex/*.woff2` against the installed package to compare.
