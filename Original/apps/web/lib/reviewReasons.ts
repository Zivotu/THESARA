export const reasonMessages: Record<string, string> = {
  eval: 'Korištenje eval zabranjeno',
  new_function: 'Korištenje new Function zabranjeno',
  function_return_this: 'Korištenje Function("return this") zabranjeno',
  remote_dynamic_import: 'Zabranjen udaljeni dynamic import',
  settimeout_string: 'setTimeout u string formi',
  window_open: 'Korištenje window.open zabranjeno',
  worker: 'Korištenje Worker zabranjeno',
  localstorage_usage: 'Korištenje localStorage zabranjeno',
  fetch_restricted_network: 'Otkriven fetch u No-Net režimu',
  network_call: 'Otkriven network call',
  window_top: 'Pristup window.top zabranjen',
  cookie_write: 'Zapisivanje document.cookie nije dozvoljeno',
  localstorage: 'Korištenje localStorage zabranjeno',
  runtime_error: 'Greška pri izvršavanju',
};

export function translateReason(code: string): string {
  return reasonMessages[code] || code;
}
