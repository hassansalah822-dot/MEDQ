// js/auth.js
console.log("MEDQ Login Script Loaded!");

import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const loginForm = document.getElementById('loginForm');
const forgotPassBtn = document.getElementById('forgotPassBtn');

if (forgotPassBtn) {
    forgotPassBtn.addEventListener('click', async () => {
        const email = document.getElementById('emailInput').value;
        if (!email) {
            alert("Please type your email address into the Email field first, then click 'Forgot password?'.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            alert("Success! A password reset link has been sent to your email.");
        } catch (error) {
            alert("Error: " + error.message);
        }
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Signing In...';
        submitBtn.disabled = true;
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            window.location.href = "dashboard.html"; 
        } catch (error) {
            alert("Login Failed: " + error.message);
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    });
} else {
    console.error("CRITICAL ERROR: Could not find the loginForm in the HTML.");
}
