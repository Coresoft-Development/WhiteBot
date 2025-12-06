/* ownerAuth.js  –─ hard-coded 1 akun owner */
const OWNER_EMAIL = 'ryuudev.new@gmail.com';   // ganti sesuka Anda
const OWNER_PASS  = '12345678';          // ganti sesuka Anda

let isLoggedIn = false;   // status login owner

module.exports = {
  login(email, pass) {
    if (email === OWNER_EMAIL && pass === OWNER_PASS) {
      isLoggedIn = true;
      return true;
    }
    return false;
  },
  logout() {
    isLoggedIn = false;
  },
  isLogged() {
    return isLoggedIn;
  }
};