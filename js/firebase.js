// Firebaseの初期化。ほかのファイルはFirebaseの関数をここから読み込む
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

export { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
export {
  doc, collection, query, where, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
const fb = configured ? initializeApp(firebaseConfig) : null;
export const auth = fb && getAuth(fb);
export const db = fb && getFirestore(fb);
