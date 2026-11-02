const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];const api=async(url,options={})=>{const headers={...(options.headers||{})};if(!(options.body instanceof FormData)&&!headers['Content-Type'])headers['Content-Type']='application/json';const r=await fetch(url,{...options,headers});const d=await r.json().catch(()=>({error:'Unexpected server response.'}));if(!r.ok)throw new Error(d.error||'Request failed');return d};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let seen=new Set(),sound=false,ctx=null;
function notice(msg,error=false){const el=$('#adminMsg');el.hidden=false;el.textContent=msg;el.className='admin-notice'+(error?' error':'');setTimeout(()=>el.hidden=true,7000)}function loginNotice(msg){const el=$('#loginMsg');el.hidden=false;el.textContent=msg;el.className='admin-notice error'}
async function check(){try{const d=await api('/api/admin/me');showApp(d.loggedIn)}catch{showApp(false)}}function showApp(on){$('#loginPanel').hidden=on;$('#dashboard').hidden=!on;if(on)refreshAll()}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});$('#loginMsg').hidden=true;showApp(true)}catch(err){loginNotice(err.message)}});$('#logoutBtn').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST'});showApp(false)});
$$('.admin-tabs button').forEach(b=>b.addEventListener('click',()=>{$$('.admin-tabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.admin-section').forEach(x=>x.classList.toggle('active',x.id==='tab-'+b.dataset.tab));if(b.dataset.tab==='bookings')loadBookings();if(b.dataset.tab==='users')loadUsers();if(b.dataset.tab==='cars')loadCars();if(b.dataset.tab==='payments')loadPayments();if(b.dataset.tab==='fares')loadFares()}));
function playAlert(){if(!sound)return;try{const C=window.AudioContext||window.webkitAudioContext;if(!ctx)ctx=new C();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.value=.12;o.start();o.stop(ctx.currentTime+.22);setTimeout(()=>{const o2=ctx.createOscillator();o2.connect(g);o2.frequency.value=660;o2.start();o2.stop(ctx.currentTime+.25)},260)}catch{}}
$('#soundToggle').addEventListener('change',e=>{sound=e.target.checked;if(sound)playAlert()});async function loadBookings(){try{const bs=await api('/api/admin/bookings');const current=new Set(bs.map(b=>b.id));if(seen.size){const added=bs.filter(b=>!seen.has(b.id));if(added.length){playAlert();notice(`${added.length} new booking${added.length>1?'s':''} received.`);if('Notification'in window&&Notification.permission==='granted')new Notification('NorthRide Cabs',{body:`${added.length} new ride request received.`})}}seen=current;$('#bookingTable').innerHTML=bs.length?`<table><thead><tr><th>REFERENCE / TIME</th><th>CUSTOMER</th><th>JOURNEY</th><th>CAR / PAYMENT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${bs.map(b=>`<tr><td><b>${esc(b.reference)}</b><br>${esc(b.pickup_date)} ${esc(b.pickup_time)}<br><small>${esc(new Date(b.created_at).toLocaleString())}</small></td><td>${esc(b.name)}<br>${esc(b.phone)}<br><small>ID: ${esc(b.user_id)}</small></td><td>${esc(b.trip_type)}<br>${esc(b.pickup)} â†’ ${esc(b.dropoff)}<br><small>${esc(b.notes||'No extra details')}</small></td><td>${esc(b.car_category)}<br>${esc(b.payment_method)}</td><td><span class="status ${esc(b.status)}">${esc(b.status)}</span></td><td><select aria-label="Update status" data-status-id="${b.id}"><option ${b.status==='Pending'?'selected':''}>Pending</option><option ${b.status==='Confirmed'?'selected':''}>Confirmed</option><option ${b.status==='Cancelled'?'selected':''}>Cancelled</option><option ${b.status==='Completed'?'selected':''}>Completed</option></select><button class="small-btn" data-save-status="${b.id}" style="margin-top:6px">Save</button></td></tr>`).join('')}</tbody></table>`:'<p>No bookings yet.</p>';$$('[data-save-status]').forEach(btn=>btn.onclick=async()=>{try{const id=btn.dataset.saveStatus,status=$(`[data-status-id="${id}"]`).value;const r=await api(`/api/admin/bookings/${id}/status`,{method:'POST',body:JSON.stringify({status})});notice(status==='Confirmed'?(r.smsConfigured?'Ride confirmed. SMS confirmation sent if carrier accepts it.':'Ride confirmed. SMS is not configured on this server.'):'Booking status updated.');loadBookings()}catch(e){notice(e.message,true)}})}catch(e){notice(e.message,true)}}
async function loadUsers(){try{const users=await api('/api/admin/users');$('#userTable').innerHTML=users.length?`<table><thead><tr><th>CUSTOMER ID</th><th>NAME</th><th>MOBILE</th><th>RIDES</th><th>CREATED</th></tr></thead><tbody>${users.map(u=>`<tr><td><b>${esc(u.id)}</b></td><td>${esc(u.name)}</td><td>${esc(u.phone)}</td><td>${u.rides}</td><td>${esc(new Date(u.created_at).toLocaleDateString())}</td></tr>`).join('')}</tbody></table>`:'<p>No customer profiles yet.</p>'}catch(e){notice(e.message,true)}}
async function loadCars(){try{const d=await api('/api/public-data');const all=await api('/api/admin/me');const cars=d.cars;$('#carList').innerHTML=cars.map(c=>`<div class="item-row"><img src="${esc(c.image_url)}" alt=""><div class="item-copy"><b>${esc(c.name)}</b><small>${esc(c.category)} Â· ${esc(c.description)}</small></div><button class="small-btn secondary" data-edit-car="${c.id}">Edit</button><button class="small-btn danger" data-delete-car="${c.id}">Delete</button></div>`).join('')+'<p style="font-size:10px;color:#879398">Only active cars appear in the public gallery.</p>';$$('[data-edit-car]').forEach(b=>b.onclick=()=>{const c=cars.find(x=>x.id===Number(b.dataset.editCar));const f=$('#carForm');f.elements.id.value=c.id;f.elements.name.value=c.name;f.elements.category.value=c.category;f.elements.image_url.value=c.image_url;f.elements.description.value=c.description;f.scrollIntoView({behavior:'smooth'})});$$('[data-delete-car]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this car/ad?')){await api(`/api/admin/cars/${b.dataset.deleteCar}`,{method:'DELETE'});loadCars();notice('Car removed.')}})}catch(e){notice(e.message,true)}}
$('#uploadCarImageBtn').addEventListener('click',async()=>{
  const file=$('#carImageFile').files[0];
  const msg=$('#carImageUploadMsg');
  if(!file){msg.hidden=false;msg.textContent='Please choose an image file first.';return}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){msg.hidden=false;msg.textContent='Choose JPG, PNG, or WEBP only.';return}
  if(file.size>5*1024*1024){msg.hidden=false;msg.textContent='Image must be 5 MB or smaller.';return}
  const data=new FormData();data.append('image',file);
  const btn=$('#uploadCarImageBtn');btn.disabled=true;msg.hidden=false;msg.textContent='Uploading image...';
  try{
    const result=await api('/api/admin/car-image',{method:'POST',body:data});
    $('#carForm').elements.image_url.value=result.imageUrl;
    msg.textContent='Image uploaded. Save the car / ad to apply it.';
  }catch(err){msg.textContent=err.message;msg.className='admin-notice error'}
  finally{btn.disabled=false}
});
$('#carForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const d=Object.fromEntries(new FormData(f));d.active=f.elements.active.checked;try{await api('/api/admin/cars',{method:'POST',body:JSON.stringify(d)});f.reset();f.elements.id.value='';notice('Car / promotion saved.');loadCars()}catch(e){notice(e.message,true)}});
async function loadPayments(){try{const d=await api('/api/public-data');$('#paymentList').innerHTML=d.payments.map(p=>`<div class="item-row"><div class="item-copy"><b>${esc(p.name)}</b><small>${esc(p.details)}</small></div><button class="small-btn secondary" data-edit-payment="${p.id}">Edit</button><button class="small-btn danger" data-delete-payment="${p.id}">Delete</button></div>`).join('');$$('[data-edit-payment]').forEach(b=>b.onclick=()=>{const p=d.payments.find(x=>x.id===Number(b.dataset.editPayment));const f=$('#paymentForm');f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.details.value=p.details;f.scrollIntoView({behavior:'smooth'})});$$('[data-delete-payment]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this payment option?')){await api(`/api/admin/payments/${b.dataset.deletePayment}`,{method:'DELETE'});loadPayments();notice('Payment option removed.')}})}catch(e){notice(e.message,true)}}
$('#paymentForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));d.active=f.elements.active.checked;try{await api('/api/admin/payments',{method:'POST',body:JSON.stringify(d)});f.reset();f.elements.id.value='';notice('Payment option saved.');loadPayments()}catch(e){notice(e.message,true)}});
async function loadFares(){
  const fares=await api('/api/admin/fares');
  $('#fareList').innerHTML=`
    <table>
      <thead><tr><th>Route</th><th>Fare</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${fares.map(f=>`
        <tr>
          <td>${esc(f.route)}</td>
          <td>₹${Number(f.fare).toLocaleString('en-IN')}</td>
          <td>${Number(f.active)===1?'Active':'Inactive'}</td>
          <td>
            <button class="small-btn" data-edit-fare="${f.id}">Edit</button>
            <button class="small-btn danger" data-delete-fare="${f.id}">Delete</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
}

$('#fareForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const data=Object.fromEntries(new FormData(form).entries());
  data.fare=Number(data.fare);
  data.active=Number(data.active);
  try{
    await api('/api/admin/fares',{
      method:'POST',
      body:JSON.stringify(data)
    });
    notice('Fare saved');
    form.reset();
    form.elements.id.value='';
    await loadFares();
  }catch(err){
    notice(err.message||'Could not save fare');
  }
});

$('#fareResetBtn').addEventListener('click',()=>{
  $('#fareForm').reset();
  $('#fareForm').elements.id.value='';
});

$('#fareList').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit-fare]');
  const del=e.target.closest('[data-delete-fare]');
  if(edit){
    const fares=await api('/api/admin/fares');
    const fare=fares.find(f=>String(f.id)===edit.dataset.editFare);
    if(fare){
      $('#fareForm').elements.id.value=fare.id;
      $('#fareForm').elements.route.value=fare.route;
      $('#fareForm').elements.fare.value=fare.fare;
      $('#fareForm').elements.active.value=String(fare.active);
      $('#fareForm').scrollIntoView({behavior:'smooth',block:'center'});
    }
  }
  if(del){
    if(!confirm('Delete this route fare?'))return;
    try{
      await api('/api/admin/fares/'+del.dataset.deleteFare,{method:'DELETE'});
      notice('Fare deleted');
      await loadFares();
    }catch(err){
      notice(err.message||'Could not delete fare');
    }
  }
});
$('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/settings',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});notice('Announcement saved.')}catch(e){notice(e.message,true)}});
$('#passwordForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});e.currentTarget.reset();notice('Password updated. Sign in with your new password next time.')}catch(e){notice(e.message,true)}});
async function refreshAll(){await Promise.all([loadBookings(),loadUsers(),loadCars(),loadPayments()]);if('Notification'in window&&Notification.permission==='default'){/* Browser permission is requested only when user enables audible alerts. */}}setInterval(()=>{if(!$('#dashboard').hidden)loadBookings()},12000);check();



