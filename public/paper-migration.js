// Paper Trading v2 migration: clear positions created by the legacy engine once.
(function(){
  try {
    var VERSION='strict-v2';
    if(localStorage.getItem('delta-paper-engine-version')!==VERSION){
      localStorage.removeItem('delta-paper-positions');
      localStorage.removeItem('delta-paper-trades');
      localStorage.setItem('delta-paper-risk','1');
      localStorage.setItem('delta-paper-engine-version',VERSION);
    }
  } catch(e) {}
})();
