//Unpack modules
PhiloGL.unpack();

//some locals
var $ = function(id) { return document.getElementById(id); },
    $$ = function(selector) { return document.querySelectorAll(selector); },
    citiesWorker = new Worker('cities.js'),
    data = { citiesRoutes: {}, airlinesRoutes: {} },
    models = {}, geom = {},
    airlineMgr = new AirlineManager(data, models),
    fx = new Fx({
      duration: 1000,
      transition: Fx.Transition.Expo.easeInOut
    }),
    airlineList, pos, tooltip;

//Get handles when document is ready
document.onreadystatechange = function() {
  if (document.readyState == 'complete' && PhiloGL.hasWebGL()) {
    airlineList = $('airline-list');
    tooltip = $('tooltip');

    //Add search handler
    $('search').addEventListener('keyup', (function() {
      var timer = null,
          parentNode = airlineList.parentNode,
          lis = airlineList.getElementsByTagName('li'),
          previousText = '';

      function search(value) {
        parentNode.removeChild(airlineList);
        for (var i = 0, l = lis.length; i < l; i++) {
          var li = lis[i],
              text = li.textContent || li.innerText;
          li.style.display = text.trim().toLowerCase().indexOf(value) > -1 ? '' : 'none';
        }
        parentNode.appendChild(airlineList);
      }

      return function(e) {
        timer = clearTimeout(timer);
        var trimmed = this.value.trim();
        if (trimmed != previousText) {
          timer = setTimeout(function() { 
            search(trimmed.toLowerCase()); 
            previousText = trimmed;
          }, 300);
        }
      };

    })(), true);
    
    //load dataset
    loadData();
  }
};

//Create earth
models.earth = new O3D.Sphere({
  nlat: 150,
  nlong: 150,
  radius: 1,
  uniforms: {
    shininess: 32
  },
  textures: ['img/earth3-specular.gif', 'img/topographic.jpg'],
  // textures: ['img/topographic.jpg'],
  program: 'earth'
});
models.earth.rotation.set(Math.PI, 0,  0);
models.earth.update();

//Create airline routes model
models.airlines = new O3D.Model({
  program: 'airline_layer',
  render: function(gl, program, camera) {
    if (this.indices) {
      gl.lineWidth(1);
      gl.drawElements(gl.LINES, this.$indicesLength, gl.UNSIGNED_SHORT, 0);
      this.dynamic = false;
    }
  }
});

//Create cities layer model and create PhiloGL app.
citiesWorker.onmessage = function(e) {
  var modelInfo = e.data;

  if (typeof modelInfo == 'number') {
      Log.write('Building models ' + modelInfo + '%');
  } else {
    data.citiesIndex = modelInfo.citiesIndex;
    models.cities = new O3D.Model(Object.create(modelInfo, {
      //Add a custom picking method
      pick: {
        value: function(pixel) {
          //calculates the element index in the array by hashing the color values
          if (pixel[0] == 0 && (pixel[1] != 0 || pixel[2] != 0)) {
            var index = pixel[2] + pixel[1] * 256;
            return index;
          }
          return false;
        }
      },

      render: {
        value: function(gl, program, camera) {
          gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);
        }
      }
    }));

    Log.write('Loading assets...');
    createApp();
  }
};

function loadData() {
  Log.write('Loading data...');
  //Request cities data
  new IO.XHR({
    url: 'data/cities.json',
    onSuccess: function(json) {
      data.cities = JSON.parse(json);
      citiesWorker.postMessage(data.cities);
      Log.write('Building models...');
    },
    onProgress: function(e) {
      Log.write('Loading airports data, please wait...' + 
                (e.total ? Math.round(e.loaded / e.total * 1000) / 10 : ''));
    },
    onError: function() {
      Log.write('There was an error while fetching cities data.', true);
    }
  }).send();

  //Request airline data
  new IO.XHR({
    url: 'data/airlines.json',
    onSuccess: function(json) {
      var airlines = data.airlines = JSON.parse(json),
          airlinePos = data.airlinePos = {},
          html = [],
          pi = Math.PI,
          pi2 = pi * 2,
          sin = Math.sin,
          cos = Math.cos,
          phi, theta, sinTheta, cosTheta, sinPhi, cosPhi;
      //assuming the data will be available after the document is ready...
      for (var i = 0, l = airlines.length -1; i < l; i++) {
        var airline = airlines[i],
            airlineId = airline[0],
            airlineName = airline[1];

        phi = pi - (+airline[3] + 90) / 180 * pi;
        theta = pi2 - (+airline[4] + 180) / 360 * pi2;
        sinTheta = sin(theta);
        cosTheta = cos(theta);
        sinPhi = sin(phi);
        cosPhi = cos(phi);
        
        airlinePos[airlineId] = [ cosTheta * sinPhi, cosPhi, sinTheta * sinPhi, phi, theta ];

        html.push('<label for=\'checkbox-' + 
                  airlineId + '\'><input type=\'checkbox\' id=\'checkbox-' + 
                      airlineId + '\' /> ' + airlineName + '</label>');
      }

      //when an airline is selected show all paths for that airline
      airlineList.addEventListener('change', function(e) {
        var target = e.target,
            airlineId = target.id.split('-')[1];
        
        function callback() {
          if (target.checked) {
            airlineMgr.add(airlineId);
            centerAirline(airlineId);
          } else {
            airlineMgr.remove(airlineId);
          }
        }

        if (data.airlinesRoutes[airlineId]) {
          callback();
        } else {
          Log.write('Fetching data for airline...');
          new IO.XHR({
            url: 'data/airlines/' + airlineId.replace(' ', '_') + '.json',
            onSuccess: function(json) {
              data.airlinesRoutes[airlineId] = JSON.parse(json);
              callback();
              Log.write('Done.', true);
            },
            onError: function() {
              Log.write('There was an error while fetching data for airline: ' + airlineId, true);
            }
          }).send();
        }
      }, false);
      
      //create right menu
      var rightMenu = new RightMenu(airlineList, airlineMgr);
      rightMenu.load('<li>' + html.join('</li><li>') + '</li>');
    
    },
    onError: function() {
      Log.write('There was an error while fetching airlines data.', true);
    }
  }).send();
}

//center the airline
function centerAirline(airlineId) {
  var pos = data.airlinePos[airlineId],
      earth = models.earth,
      cities = models.cities,
      airlines = models.airlines,
      phi = pos[3],
      theta = pos[4],
      phiPrev = geom.phi || Math.PI / 2,
      thetaPrev = geom.theta || (3 * Math.PI / 2),
      phiDiff = phi - phiPrev,
      thetaDiff = theta - thetaPrev;
    
  geom.matEarth = earth.matrix.clone();
  geom.matCities = cities.matrix.clone();
  geom.matAirlines = airlines.matrix.clone();

  fx.start({
    onCompute: function(delta) {
      rotateXY(phiDiff * delta, thetaDiff * delta);
    },

    onComplete: function() {
      geom.phi = phi;
      geom.theta = theta;
    }
  });
}
//rotate the planet of phi and theta angles
function rotateXY(phi, theta) {
  var earth = models.earth,
      cities = models.cities,
      airlines = models.airlines,
      xVec = [1, 0, 0],
      yVec = [0, 1, 0],
      yVec2 =[0, -1, 0];
  
  earth.matrix = geom.matEarth.clone();
  cities.matrix = geom.matCities.clone();
  airlines.matrix = geom.matAirlines.clone();
      
  var m1 = new Mat4(),
      m2 = new Mat4();
  
  m1.$rotateAxis(phi, xVec);
  m2.$rotateAxis(phi, xVec);

  m1.$mulMat4(earth.matrix);
  m2.$mulMat4(cities.matrix);

  var m3 = new Mat4(),
      m4 = new Mat4();
  
  m3.$rotateAxis(theta, yVec2);
  m4.$rotateAxis(theta, yVec);

  m1.$mulMat4(m3);
  m2.$mulMat4(m4);

  earth.matrix = m1;
  cities.matrix = m2;
  airlines.matrix = m2;
}

function createApp() {
  //Create application
  PhiloGL('map-canvas', {
    program: [{
      //to render cities and routes
      id: 'airline_layer',
      from: 'uris',
      path: 'shaders/',
      vs: 'airline_layer.vs.glsl',
      fs: 'airline_layer.fs.glsl',
      noCache: true
    }, {
      //to render cities and routes
      id: 'layer',
      from: 'uris',
      path: 'shaders/',
      vs: 'layer.vs.glsl',
      fs: 'layer.fs.glsl',
      noCache: true
    },{
      //to render the globe
      id: 'earth',
      from: 'uris',
      path: 'shaders/',
      vs: 'earth.vs.glsl',
      fs: 'earth.fs.glsl',
      noCache: true
    }, {
      //for glow post-processing
      id: 'glow',
      from: 'uris',
      path: 'shaders/',
      vs: 'glow.vs.glsl',
      fs: 'glow.fs.glsl',
      noCache: true
    }],
    camera: {
      position: {
        x: 0, y: 0, z: -4
      }
    },
    scene: {
      lights: {
        enable: true,
        ambient: {
          r: 0.4,
          g: 0.4,
          b: 0.4
        },
        points: {
          diffuse: { 
            r: 0.8, 
            g: 0.8, 
            b: 0.8 
          },
          specular: { 
            r: 0.9, 
            g: 0.9, 
            b: 0.9 
          },
          position: { 
            x: 2, 
            y: 2, 
            z: -4 
          }
        }
      }
    },
    events: {
      centerOrigin: false,
      onDragStart: function(e) {
        pos = pos || {};
        pos.x = e.x;
        pos.y = e.y;
        pos.started = true;
        
        geom.matEarth = models.earth.matrix.clone();
        geom.matCities = models.cities.matrix.clone();
        geom.matAirlines = models.airlines.matrix.clone();
      },
      onDragMove: function(e) {
        var phi = geom.phi,
            theta = geom.theta,
            clamp = function(val, min, max) {
                return Math.max(Math.min(val, max), min);
            },
            y = -(e.y - pos.y) / 100,
            x = (e.x - pos.x) / 100;

        rotateXY(y, x);
        
      },
      onDragEnd: function(e) {
        var y = -(e.y - pos.y) / 100,
            x = (e.x - pos.x) / 100,
            newPhi = (geom.phi + y) % Math.PI,
            newTheta = (geom.theta + x) % (Math.PI * 2);

        newPhi = newPhi < 0 ? (Math.PI + newPhi) : newPhi;
        newTheta = newTheta < 0 ? (Math.PI * 2 + newTheta) : newTheta;
        
        geom.phi = newPhi;
        geom.theta = newTheta;
        
        pos.started = false;
      },
      onMouseWheel: function(e) {
        var camera = this.camera,
            from = -4.2,
            to = -2.275,
            pos = camera.position,
            pz = pos.z,
            speed = (1 - Math.abs((pz - from) / (to - from) * 2 - 1)) / 6 + 0.001; 

        pos.z += e.wheel * speed;
        
        if (pos.z > -2.275) {
            pos.z = -2.275;
        } else if (pos.z < -4.2) {
            pos.z = -4.2;
        }
        
        camera.update();
      }
    },
    textures: {
      src: ['img/earth3-specular.gif', 'img/topographic.jpg'],
      // src: ['img/topographic.jpg'],
      parameters: [{
        name: 'TEXTURE_MAG_FILTER',
        value: 'LINEAR'
      }, {
        name: 'TEXTURE_MIN_FILTER',
        value: 'LINEAR_MIPMAP_NEAREST',
        generateMipmap: true
      }]
    },
    onError: function() {
      Log.write("There was an error creating the app.", true);
    },
    onLoad: function(app) {
      Log.write('Done.', true);

      //Unpack app properties
      var gl = app.gl,
          scene = app.scene,
          camera = app.camera,
          canvas = app.canvas,
          width = canvas.width,
          height = canvas.height,
          program = app.program,
          renderCamera = new Camera(camera.fov, 
                                    camera.aspect, 
                                    camera.near, 
                                    camera.far, {
            position: { x: 0, y: 0, z: -4.125 }
          }),
          renderScene = new Scene(program, renderCamera),
          glowScene = new Scene(program, camera, scene.config),
          clearOpt = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;

      renderCamera.update();
      app.renderCamera = renderCamera;
       
      gl.clearColor(0.1, 0.1, 0.1, 1);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      
      models.frontPlane = new O3D.Plane({
        type: 'x,y',
        xlen: width / 100,
        ylen: height / 100,
        nx: 5,
        ny: 5,
        offset: 0,
        textures: ['glow-texture', 'render-texture'],
        program: 'glow'
      });

      //create shadow, glow and image framebuffers
      var framebufferOptions = {
        width: 1024,
        height: 1024,
        bindToTexture: {
          parameters: [{
            name: 'TEXTURE_MAG_FILTER',
            value: 'LINEAR'
          }, {
            name: 'TEXTURE_MIN_FILTER',
            value: 'LINEAR_MIPMAP_NEAREST',
            generateMipmap: false
          }]
        },
        bindToRenderBuffer: true
      };

      app.setFrameBuffers({
        glow: framebufferOptions,
        render:framebufferOptions
      });

      //picking scene
      scene.add(models.earth,
                models.cities,
                models.airlines);

      //rendered on-screen scene
      renderScene.add(models.frontPlane);

      //post processing glow scene
      glowScene.add(models.earth,
                    models.cities,
                    models.airlines);
     
      draw();
      
      //Select first airline
      $$('#airline-list li input')[0].click();
      $('list-wrapper').style.display = '';

      function draw() {
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.viewport(0, 0, 1024, 1024);
        drawTextures();
        
        gl.viewport(0, 0, width, height);
        drawEarth();
      }

      function drawTextures() {
        var earthProg = program.earth;
        //render to a texture to be blurred
        app.setFrameBuffer('glow', true);
        gl.clear(clearOpt);
        earthProg.use();
        earthProg.setUniform('renderType',  0);
        glowScene.renderToTexture('glow');
        app.setFrameBuffer('glow', false);
        
        //render the actual picture with the planet and all
        app.setFrameBuffer('render', true);
        gl.clear(clearOpt);
        earthProg.use();
        earthProg.setUniform('renderType', -1);
        scene.renderToTexture('render');
        app.setFrameBuffer('render', false);
      }

      //Draw to screen
      function drawEarth() {
        gl.clear(clearOpt);
        renderScene.render();
        Fx.requestAnimationFrame(draw);
      }
    }
  });
}


