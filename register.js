// js/register.js
console.log("MEDQ Register Script Loaded!");

import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const registerForm = document.getElementById('registerForm');

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        
        const name = document.getElementById('nameInput').value;
        const email = document.getElementById('regEmailInput').value;
        const password = document.getElementById('regPasswordInput').value;
        
        const phone = document.getElementById('regPhoneInput').value;
        const profession = document.getElementById('regProfessionInput').value;
        const university = document.getElementById('regUniversityInput').value;

        const submitBtn = registerForm.querySelector('button[type="submit"]');
        
        submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Creating...';
        submitBtn.disabled = true;
        lucide.createIcons();

        // Establish role: assign admin if email matches the criteria
        let userRole = "student";
        const cleanEmail = email.toLowerCase().trim();
        if (cleanEmail === "abodi10salah@gmail.com" || cleanEmail === "salahaldin10111@gmail.com") {
            userRole = "admin";
        }

        try {
            console.log("Attempting to create user...");
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await updateProfile(user, { displayName: name });

            const trialExpiresAt = new Date().getTime() + (3 * 24 * 60 * 60 * 1000);

            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                email: user.email,
                displayName: name,
                phone: phone || "Not provided",
                profession: profession,
                university: university,
                role: userRole, 
                accessExpiresAt: trialExpiresAt,
                stats: { questionsSolved: 0, correctAnswers: 0 },
                createdAt: serverTimestamp()
            });

            alert(userRole === 'admin' ? "Admin account successfully registered!" : "Account created successfully! Enjoy your 3-day free trial.");
            window.location.href = "dashboard.html"; 
            
        } catch (error) {
            console.error("Firebase Error:", error);
            alert("Registration Failed: " + error.message);
            submitBtn.innerHTML = 'Complete Registration <i data-lucide="user-plus" class="w-5 h-5"></i>';
            submitBtn.disabled = false;
            lucide.createIcons();
        }
    });
} else {
    console.error("CRITICAL ERROR: Could not find the registerForm in the HTML.");
}
