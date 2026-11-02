const $=s=>document.querySelector(s);const api=async(url,options={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const d=await r.json().catch(()=>({error:'Unexpected server response.'}));if(!r.ok)throw new Error(d.error||'Request failed');return d};
$('#year').textContent=new Date().getFullYear();$('#menuToggle').addEventListener('click',()=>document.querySelector('nav').classList.toggle('open'));document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('nav').classList.remove('open')));
const dateInput=$('#pickupDate');const localToday=new Date();dateInput.min=`${localToday.getFullYear()}-${String(localToday.getMonth()+1).padStart(2,'0')}-${String(localToday.getDate()).padStart(2,'0')}`;
let publicData={};async function loadPublic(){try{publicData=await api('/api/public-data');
const savedFares=publicData.fares||[];
const fareGrid=$('#onewayFareList');
if(fareGrid){
fareGrid.innerHTML=savedFares.map(f=>{
const price=Number(f.fare);
const fareText=Number.isFinite(price)&&price>0?'₹'+price.toLocaleString('en-IN'):'Fare on request';
return `<article class="oneway-fare-card"><span class="fare-route-label">ONE-WAY</span><h3>${esc(f.route)}</h3><div class="fare-price">${fareText}</div><a class="fare-book-link" href="#booking" data-fare-route="${esc(f.route)}">Book this route →</a></article>`;
}).join('')||'<p class="fare-loading">Route fares will be announced soon. Please contact us for a quote.</p>';
}
const fareKeys={
'Chandigarh to Delhi':'chandigarh_delhi',
'Chandigarh to Noida':'chandigarh_noida',
'Chandigarh to Ghaziabad':'chandigarh_ghaziabad',
'Chandigarh to Gurugram':'chandigarh_gurugram',
'Chandigarh to Patiala':'chandigarh_patiala',
'Chandigarh to Ludhiana':'chandigarh_ludhiana',
'Chandigarh to Amritsar':'chandigarh_amritsar'
};
document.querySelectorAll('[data-fare-route]').forEach(link=>{
const route=link.dataset.fareRoute;
const key=fareKeys[route];
const price=Number(savedFares[key]);
const card=link.closest('.fare-card');
const priceElement=card?.querySelector('.fare-price');
if(key&&Number.isFinite(price)&&price>0&&priceElement&&!priceElement.classList.contains('fare-price-request')){
priceElement.textContent='₹'+price.toLocaleString('en-IN');
}
});$('#paymentMethod').innerHTML='<option value="">Choose payment method</option>'+publicData.payments.map(p=>`<option value="${esc(p.name)}" data-details="${esc(p.details)}">${esc(p.name)}</option>`).join('');$('#paymentMethod').addEventListener('change',()=>$('#paymentHint').textContent=$('#paymentMethod').selectedOptions[0]?.dataset.details||'');$('#carGallery').innerHTML=publicData.cars.length?publicData.cars.map(c=>`<article class="car-card"><img class="car-image" src="${esc(c.image_url)}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.display='none'"><div class="car-info"><div class="car-meta"><span>${esc(c.category)}</span><span>4-WHEELER</span></div><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><a class="car-book" href="#booking">Request this car <span>â†—</span></a></div></article>`).join(''):'<p>No cars listed yet. Please call us to discuss your ride.</p>';if(publicData.settings.announcement){/* reserved for future announcement banner */}}catch(e){$('#carGallery').innerHTML='<p>Cars could not load right now. Please call us to book.</p>';$('#paymentHint').textContent='Payment options could not load. Refresh this page.'}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let bookingSubmitting = false;

$('#bookingForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (bookingSubmitting) return;

  const form = e.currentTarget;
  const btn = $('#submitBooking');
  const msg = $('#bookingMessage');

  bookingSubmitting = true;
  btn.disabled = true;
  btn.textContent = 'Sending request...';

  msg.className = 'message';
  msg.textContent = '';

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const d = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    msg.className = 'message success';
    msg.innerHTML = `<b>Booking request received.</b><br>
      Reference: ${esc(d.reference)} ? Your customer ID: ${esc(d.userId)}<br>
      Our team will contact you to confirm your ride. Keep this reference for your records.`;

    form.reset();
    $('#pickup').value = 'Chandigarh';

    dateInput.min =
      `${localToday.getFullYear()}-${String(localToday.getMonth()+1).padStart(2,'0')}-${String(localToday.getDate()).padStart(2,'0')}`;

    window.scrollTo({
      top: $('#booking').offsetTop - 90,
      behavior: 'smooth'
    });

  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;

  } finally {
    bookingSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = 'Request a ride <span>?</span>';
  }
});
loadPublic();




// =========================================
// NORTHRIDE CUSTOMER RATING FUNCTIONALITY
// =========================================
(function () {
  const form = document.getElementById("ratingForm");
  const starButtons = document.querySelectorAll(".rating-star");
  const selection = document.getElementById("ratingSelection");
  const submitButton = document.getElementById("ratingSubmit");
  const commentInput = document.getElementById("ratingComment");
  const message = document.getElementById("ratingMessage");

  if (!form || !starButtons.length || !submitButton) {
    console.warn("Rating form elements were not found.");
    return;
  }

  let selectedRating = 0;

  function paintStars(rating) {
    starButtons.forEach(function (button) {
      const value = Number(button.dataset.star);
      button.classList.toggle("active", value <= rating);
      button.textContent = value <= rating ? "★" : "☆";
      button.setAttribute("aria-pressed", value === rating ? "true" : "false");
    });
  }

  starButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectedRating = Number(button.dataset.star);

      paintStars(selectedRating);

      if (selection) {
        selection.textContent =
          selectedRating + (selectedRating === 1 ? " star selected" : " stars selected");
      }

      submitButton.disabled = false;

      if (message) {
        message.textContent = "";
      }
    });
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (selectedRating < 1 || selectedRating > 5) {
      if (message) message.textContent = "Please select a star rating first.";
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    if (message) {
      message.textContent = "";
    }

    try {
      const response = await fetch("/api/ratings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          stars: selectedRating,
          comment: commentInput ? commentInput.value.trim() : ""
        })
      });

      const result = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        throw new Error(result.message || result.error || "Could not submit rating.");
      }

      if (message) {
        message.textContent = "Thank you! Your rating has been submitted.";
      }

      form.reset();
      selectedRating = 0;
      paintStars(0);

      if (selection) {
        selection.textContent = "Select your rating";
      }

    } catch (error) {
      if (message) {
        message.textContent = error.message || "Rating submission failed. Please try again.";
      }
    } finally {
      submitButton.disabled = selectedRating === 0;
      submitButton.textContent = "Submit rating";
    }
  });

  paintStars(0);
})();

// END NORTHRIDE CUSTOMER RATING FUNCTIONALITY

