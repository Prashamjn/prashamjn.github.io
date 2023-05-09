function addToResult(value) {
    document.getElementById('result').value += value;
  }
  
  function clearResult() {
    document.getElementById('result').value = '';
  }
  
  function clearEntry() {
    var result = document.getElementById('result').value;
    document.getElementById('result').value = result.substring(0, result.length - 1);
  }
  
  function calculateResult() {
    var result = eval(document.getElementById('result').value);
    document.getElementById('result').value = result;
  }
  