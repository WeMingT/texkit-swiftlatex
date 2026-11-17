// Synchronous kpse bridge; C import names and signatures are unchanged.
mergeInto(LibraryManager.library, {
  kpse_find_file_js_async__sig: 'iiii',
  kpse_find_file_js_async: function(nameptr, format, mustexist) {
    return Module['kpse_find_file_impl'](nameptr, format, mustexist);
  },
  kpse_find_pk_js_async__sig: 'iii',
  kpse_find_pk_js_async: function(nameptr, dpi) {
    return Module['kpse_find_pk_impl'](nameptr, dpi);
  }
});
