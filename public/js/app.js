(() => {
  document.querySelectorAll('textarea[data-counter]').forEach((textarea) => {
    const counter = document.getElementById(textarea.dataset.counter);
    if (!counter) return;
    const max = Number(textarea.getAttribute('maxlength')) || Infinity;
    const update = () => {
      const length = [...textarea.value].length;
      counter.textContent = String(length);
      counter.classList.toggle('text-danger', length > max * 0.95);
    };
    textarea.addEventListener('input', update);
    update();
  });

  document.querySelectorAll('input[type="file"][data-max-mb]').forEach((input) => {
    const preview = document.querySelector(`[data-preview-for="${input.id}"]`);
    const maxBytes = Number(input.dataset.maxMb) * 1024 * 1024;
    let objectUrl = null;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.setCustomValidity('');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;

      if (file && file.size > maxBytes) {
        input.setCustomValidity(`Файл больше ${input.dataset.maxMb} МБ.`);
        input.reportValidity();
      }

      if (!preview) return;
      if (file && file.type.startsWith('image/')) {
        objectUrl = URL.createObjectURL(file);
        preview.querySelector('img').src = objectUrl;
        preview.classList.remove('d-none');
      } else {
        preview.classList.add('d-none');
      }
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });
})();
