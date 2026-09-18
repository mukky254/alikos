# Aliko — new site-wide features (this batch)

Honest framing first: your site already had 100 documented capabilities
(see `ALIKO-100-CAPABILITIES.md`) — save/share/call/WhatsApp/CSV export/
recently-viewed/deals/open-now/category filters/analytics were already
real and working. This batch adds **genuinely new, working** features on
top, without duplicating any of that. Nothing here is a mockup — every
item below is real code, wired up, syntax-checked.

Every page (`index`, `business`, `saved`, `deals`, `dashboard`, `account`,
`admin`, `login`, `signup`, `register`, `reset-password`,
`forgot-password`, `recently-viewed`, and a new `404`) now loads
`js/shared.js` + `css/shared.css`, so most of these work site-wide, not
just on one page.

## Site-wide (js/shared.js + css/shared.css)
1. Upgraded toast/snackbar system (stacks multiple messages, was single-slot before)
2. Copy-to-clipboard helper with a legacy-browser fallback
3. Native share-sheet integration with automatic clipboard fallback
4. Debounce utility (used to throttle scroll listeners etc.)
5. Scroll-to-top floating button, appears after scrolling
6. Online/offline network-status banner
7. `prefers-reduced-motion` support — animations disabled site-wide for users who've set that OS preference
8. Keyboard shortcuts: `/` focuses the search box, `Esc` blurs the active field
9. Lazy-image-loading helper (IntersectionObserver-based, ready for any `<img data-src>`)
10. QR-code generator for any URL (free, no API key)
11. `.ics` calendar file generator + download (used for deal reminders)
12. JSON-LD structured-data injector (for richer Google search previews)
13. Dynamic page `<title>`/meta-description updater
14. Show/hide toggle on every password field, site-wide
15. Live password-strength meter on signup/new-password fields
16. Breadcrumb-trail component
17. Skeleton-loader placeholders (shimmer effect) for content still loading
18. PWA install-prompt capture + floating "Install Aliko" button
19. Service-worker registration
20. Print-friendly stylesheet (hides chrome/nav, clean layout for `Ctrl+P`)
21. Focus-visible outlines site-wide for keyboard navigation/accessibility
22. Embed-code generator (business owners can copy an iframe-free HTML snippet linking back to their listing)
23. "Continue where you left off" resume banner on the homepage (from local browsing history)

## Infrastructure
24. `manifest.json` + real generated app icons — installable PWA
25. `sw.js` — offline app-shell caching (API calls are never cached, so business data is always live)
26. `robots.txt`
27. `sitemap.xml` (static pages; dynamic business pages need a server-side generator — noted honestly in the file itself, not faked)
28. Branded `404.html` page (Vercel serves this automatically for unmatched routes)

## Business page (business.js / business.html)
29. Breadcrumb: Discover → Category → Business name
30. Copy-address button
31. Copy-phone button
32. Copy-link button
33. Print button
34. QR-code panel (toggleable, scan to open the listing)
35. Embed-code button (owners only)
36. JSON-LD `LocalBusiness` structured data (name, address, geo, rating) for SEO
37. Dynamic page title/description per business
38. Interactive star-rating input for reviews (replaces the plain dropdown, same underlying value)
39. Review photo preview before upload
40. "Remind me" button on active deals — downloads a calendar (.ics) reminder

## Discover / home page (home.js / index.html)
41. URL query sync — filtered/sorted searches are now shareable/bookmarkable links (`?q=...&category=...&sort=...`)
42. Skeleton loaders while results are fetching (was a blank pane before)
43. "Clear filters" button

## Admin (admin.js / admin.html)
44. Checkbox on each pending listing
45. Bulk-select bar with live selection count
46. Bulk "Verify selected" — loops the existing single-item verify endpoint, no backend change needed
47. "Clear selection" button

## Notes on what's *not* included, on purpose
- No backend/API files were modified — everything above uses existing
  endpoints. This keeps the change surface small and low-risk.
- The sitemap doesn't enumerate individual business pages — that needs a
  server-side generator reading your businesses table, which is a backend
  task, not something a static file can fake correctly.
- `manifest.json` icons are real generated PNGs, not placeholders — check
  `public/icons/` if you want to swap in your actual logo later.
