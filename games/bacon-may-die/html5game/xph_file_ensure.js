///
function file_ensure_js(path, content) {
    try {
        if (!PluStore.files.has(path)) {
            PluStore.files.write(path, content);
            return 1;                
        }
    } catch (e) {
        console.log(e);
    }
    return 0;
}