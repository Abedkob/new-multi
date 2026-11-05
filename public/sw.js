/**
 * The admin service worker: push and notification clicks, and nothing else (D57).
 *
 * What is deliberately absent is the point of this file. There is **no `fetch` handler and no
 * use of the Cache API**, and that is not an omission to be fixed later:
 *
 *   - A `fetch` handler is how an admin PWA starts serving a stale order list — a merchant
 *     looking at yesterday's orders, confidently, with no way to tell.
 *   - A cache is how authenticated HTML, order data and customer details end up at rest on a
 *     device this platform does not control and cannot wipe.
 *
 * Version 1 of the admin app is network-dependent on purpose (§11.1). `verify:notifications`
 * asserts this file contains neither, so "we'll add offline later" has to be a decision rather
 * than a commit nobody noticed.
 *
 * Plain JavaScript in `public/`, not a compiled route: a service worker must be served from the
 * scope it controls, with no build step between what is reviewed here and what runs on a phone.
 */

/* global self */

/** Notification ids this device has already shown, so a retry replaces rather than repeats. */
const SEEN_LIMIT = 50;
let seen = [];

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every tab to close: an owner who just enabled
  // notifications expects the next order to arrive, not the one after they restart the browser.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push with a body we did not send. Show nothing: a notification saying "undefined" is
    // worse than a notification that never arrives.
    return;
  }

  const tag = typeof payload.tag === "string" ? payload.tag : "admin";
  // The device's own half of the deduplication story (D52). The push service may deliver one
  // message twice, and `tag` alone replaces the banner — this also discards the second copy so
  // the phone does not buzz again for something already seen.
  if (seen.includes(tag)) return;
  seen = [tag, ...seen].slice(0, SEEN_LIMIT);

  event.waitUntil(
    self.registration.showNotification(payload.title || "Update", {
      body: payload.body || "",
      tag,
      // Replaces an earlier banner with the same tag instead of stacking a second one.
      renotify: false,
      lang: payload.lang === "ar" ? "ar" : "en",
      dir: payload.dir === "rtl" ? "rtl" : "ltr",
      data: { destination: typeof payload.destination === "string" ? payload.destination : "/admin" },
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = (event.notification.data && event.notification.data.destination) || "/admin";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus a window that is already open on this app rather than opening a second one: an
      // owner tapping a notification three times should not end up with three admin tabs.
      for (const client of windows) {
        const url = new URL(client.url);
        if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/platform")) {
          await client.focus();
          if ("navigate" in client) await client.navigate(destination);
          return;
        }
      }
      await self.clients.openWindow(destination);
    })(),
  );
});

/**
 * The push service told the browser this subscription has been replaced.
 *
 * Nothing is re-subscribed here: that needs the application server key and a logged-in session,
 * neither of which a service worker has. The admin screen re-registers on its next load, and
 * until then the stale endpoint fails with 410 and is cleaned up server-side.
 */
self.addEventListener("pushsubscriptionchange", () => {
  seen = [];
});
