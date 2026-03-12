import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBX-7B89aIYx7UghiEZeqdmF2DeQS4YaVE",
  authDomain: "sitio-voo-dos-gansos.firebaseapp.com",
  projectId: "sitio-voo-dos-gansos",
  storageBucket: "sitio-voo-dos-gansos.firebasestorage.app",
  messagingSenderId: "467417505201",
  appId: "1:467417505201:web:630578de172ec8f57bf190"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
